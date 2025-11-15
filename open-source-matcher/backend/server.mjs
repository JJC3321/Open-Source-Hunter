import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import Redis from "ioredis";
import { randomUUID } from "crypto";
import {
  CopilotRuntime,
  GoogleGenerativeAIAdapter,
  copilotRuntimeNodeExpressEndpoint,
} from "@copilotkit/runtime";

dotenv.config();

const PORT = Number(process.env.PORT ?? 4000);
const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const REQUEST_QUEUE = process.env.HUNTER_REQUEST_QUEUE ?? "hunter:requests";
const RESULT_PREFIX = process.env.HUNTER_RESULT_PREFIX ?? "hunter:results";
const JOB_METADATA_PREFIX = process.env.HUNTER_JOB_META_PREFIX ?? "hunter:job";
const JOB_TTL_SECONDS = Number(process.env.HUNTER_JOB_TTL_SECONDS ?? 300);
const SEARCH_TIMEOUT_MS = Number(process.env.SEARCH_TIMEOUT_MS ?? 20000);
const DEFAULT_RESULT_LIMIT = Number(process.env.HUNTER_DEFAULT_LIMIT ?? 6);
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

if (!GEMINI_API_KEY) {
  console.error(
    "[backend] Missing GEMINI_API_KEY environment variable.\nSet GEMINI_API_KEY (or GOOGLE_API_KEY) in your .env file before starting the backend.",
  );
  process.exit(1);
}

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});
const blockingRedis = redis.duplicate();

async function enqueueJob(payload) {
  const jobId = randomUUID();
  const request = {
    id: jobId,
    requestedAt: new Date().toISOString(),
    payload,
  };

  const metaKey = `${JOB_METADATA_PREFIX}:${jobId}`;
  await redis
    .multi()
    .set(metaKey, JSON.stringify({ status: "queued", ...payload }), "EX", JOB_TTL_SECONDS)
    .rpush(REQUEST_QUEUE, JSON.stringify(request))
    .exec();

  return { jobId, request };
}

async function waitForResult(jobId) {
  const resultQueue = `${RESULT_PREFIX}:${jobId}`;
  const deadline = Date.now() + SEARCH_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const remainingSeconds = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
    const response = await blockingRedis.brpop(resultQueue, remainingSeconds);

    if (!response) {
      continue;
    }

    const [, raw] = response;

    try {
      const parsed = JSON.parse(raw);
      await redis.del(resultQueue);
      await redis.set(
        `${JOB_METADATA_PREFIX}:${jobId}`,
        JSON.stringify({ status: parsed.status ?? "completed", completedAt: new Date().toISOString() }),
        "EX",
        JOB_TTL_SECONDS,
      );
      return parsed;
    } catch (error) {
      console.error("[backend] Failed to parse worker response", error);
      throw new Error("Received malformed data from worker");
    }
  }

  throw new Error("Search timed out before the worker responded. Please try again.");
}

const runtime = new CopilotRuntime({
  actions: [
    {
      name: "searchOpenSourceProjects",
      description:
        "Dispatches a hunter job that finds high-quality open-source repositories matching the supplied filters.",
      parameters: [
        {
          name: "topic",
          description: "Main keywords or problem statement for the search.",
          type: "string",
          required: true,
        },
        {
          name: "language",
          description: "Preferred primary programming language (e.g. TypeScript, Rust)",
          type: "string",
          required: false,
        },
        {
          name: "minStars",
          description: "Minimum number of GitHub stars the project should have.",
          type: "number",
          required: false,
        },
        {
          name: "onlyMaintained",
          description: "Set to true to filter for projects with recent commits (last 12 months).",
          type: "boolean",
          required: false,
        },
        {
          name: "limit",
          description: "Maximum number of projects to return (defaults to 6).",
          type: "number",
          required: false,
        },
      ],
      handler: async ({ topic, language, minStars, onlyMaintained, limit }) => {
        const trimmedTopic = topic?.trim();
        if (!trimmedTopic) {
          throw new Error("A non-empty topic is required to search for projects.");
        }

        const effectiveLimit = Number(limit) > 0 ? Math.min(Number(limit), 15) : DEFAULT_RESULT_LIMIT;

        const { jobId } = await enqueueJob({
          topic: trimmedTopic,
          language: language?.trim() || undefined,
          minStars: typeof minStars === "number" ? minStars : undefined,
          onlyMaintained: Boolean(onlyMaintained),
          limit: effectiveLimit,
        });

        const result = await waitForResult(jobId);

        if (result?.status === "error") {
          throw new Error(result.error ?? "Worker failed to process the search request.");
        }

        return {
          jobId,
          receivedAt: new Date().toISOString(),
          ...result,
        };
      },
    },
  ],
});

const serviceAdapter = new GoogleGenerativeAIAdapter({
  apiKey: GEMINI_API_KEY,
  model: GEMINI_MODEL,
});

const app = express();
app.disable("x-powered-by");

if (CORS_ORIGINS.length === 0 || CORS_ORIGINS.includes("*")) {
  app.use(cors());
} else {
  app.use(
    cors({
      origin: CORS_ORIGINS,
      credentials: false,
    }),
  );
}

app.get("/health", async (_req, res) => {
  try {
    const pong = await redis.ping();
    res.json({
      status: "ok",
      redis: pong,
      requestQueue: REQUEST_QUEUE,
      resultPrefix: RESULT_PREFIX,
      time: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ status: "error", error: error instanceof Error ? error.message : String(error) });
  }
});

const yoga = copilotRuntimeNodeExpressEndpoint({
  runtime,
  serviceAdapter,
  endpoint: "/copilotkit",
  logLevel: process.env.LOG_LEVEL ?? "info",
});

app.use("/copilotkit", yoga);

const server = app.listen(PORT, () => {
  console.log(`[backend] Copilot server listening on port ${PORT}`);
});

const shutdownSignals = ["SIGINT", "SIGTERM", "SIGQUIT"];
shutdownSignals.forEach((signal) => {
  process.on(signal, async () => {
    console.log(`\n[backend] Received ${signal}, closing gracefully...`);
    try {
      server.close();
      await redis.quit();
      await blockingRedis.quit();
    } catch (error) {
      console.error("[backend] Error during shutdown", error);
    } finally {
      process.exit(0);
    }
  });
});
