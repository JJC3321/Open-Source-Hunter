import dotenv from "dotenv";
import Redis from "ioredis";
import fs from "fs";
import path from "path";

dotenv.config();
const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: false });
}

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const REQUEST_QUEUE = process.env.HUNTER_REQUEST_QUEUE ?? "hunter:requests";
const RESULT_PREFIX = process.env.HUNTER_RESULT_PREFIX ?? "hunter:results";
const JOB_METADATA_PREFIX = process.env.HUNTER_JOB_META_PREFIX ?? "hunter:job";
const RESULT_TTL_SECONDS = Number(process.env.HUNTER_RESULT_TTL_SECONDS ?? 300);
const DEFAULT_ONLY_MAINTAINED_MONTHS = Number(process.env.HUNTER_MAINTAINED_MONTH_WINDOW ?? 12);
const USER_AGENT = process.env.HUNTER_USER_AGENT ?? "open-source-hunter/0.2.0";
const TAVILY_API_KEY = process.env.TAVILY_API_KEY ?? "";
const TAVILY_SEARCH_ENDPOINT = "https://api.tavily.com/search";

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});
const hasTavily = Boolean(TAVILY_API_KEY);
if (!hasTavily) {
  console.warn("[worker] TAVILY_API_KEY not set. Project descriptions will rely on GitHub metadata only.");
}

async function setJobStatus(id, status, extra = {}) {
  const metaKey = `${JOB_METADATA_PREFIX}:${id}`;
  await redis.set(
    metaKey,
    JSON.stringify({ status, updatedAt: new Date().toISOString(), ...extra }),
    "EX",
    RESULT_TTL_SECONDS,
  );
}

function buildGitHubQuery({ topic, language, minStars, onlyMaintained, limit }) {
  const segments = [];
  const quotedTopic = topic.includes(" ") ? `"${topic}"` : topic;
  segments.push(`${quotedTopic} in:name,description,readme`);

  if (language) {
    segments.push(`language:${language}`);
  }

  if (typeof minStars === "number" && Number.isFinite(minStars) && minStars > 0) {
    segments.push(`stars:>=${Math.floor(minStars)}`);
  }

  if (onlyMaintained) {
    const since = new Date();
    since.setMonth(since.getMonth() - DEFAULT_ONLY_MAINTAINED_MONTHS);
    const iso = since.toISOString().split("T")[0];
    segments.push(`pushed:>=${iso}`);
  }

  const query = segments.join(" ");
  return `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${Math.min(limit * 2, 50)}`;
}

function describeFreshness(daysSinceUpdate) {
  if (!Number.isFinite(daysSinceUpdate)) {
    return "unknown activity";
  }
  if (daysSinceUpdate <= 7) return "updated this week";
  if (daysSinceUpdate <= 30) return "updated this month";
  if (daysSinceUpdate <= 90) return "activity within the last quarter";
  if (daysSinceUpdate <= 180) return "activity within the last six months";
  if (daysSinceUpdate <= 365) return "activity within the last year";
  return "no recent commits in the last year";
}

function cleanDescription(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    return "";
  }
  return value;
}

function normalizeRepo(repo) {
  const updatedAt = repo.pushed_at ?? repo.updated_at;
  const daysSinceUpdate = updatedAt
    ? Math.round((Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24))
    : Number.POSITIVE_INFINITY;

  const starScore = Math.log10(repo.stargazers_count + 1) * 2.5;
  const forkScore = Math.log10(repo.forks_count + 1) * 1.5;
  const watcherScore = Math.log10(repo.watchers_count + 1);
  const freshnessScore = Number.isFinite(daysSinceUpdate)
    ? Math.max(0, 3 - daysSinceUpdate / 120)
    : 0;
  const issuePenalty = Math.log10(repo.open_issues_count + 1);

  const score = starScore + forkScore + watcherScore + freshnessScore - issuePenalty;

  const reasons = [
    repo.stargazers_count ? `${repo.stargazers_count.toLocaleString()} stars` : null,
    repo.forks_count ? `${repo.forks_count.toLocaleString()} forks` : null,
    describeFreshness(daysSinceUpdate),
    repo.license?.spdx_id ? `License: ${repo.license.spdx_id}` : null,
  ].filter(Boolean);

  return {
    id: repo.id,
    name: repo.full_name,
    url: repo.html_url,
    description: cleanDescription(repo.description),
    homepage: repo.homepage,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    watchers: repo.watchers_count,
    openIssues: repo.open_issues_count,
    language: repo.language,
    topics: repo.topics ?? [],
    license: repo.license?.spdx_id ?? repo.license?.name ?? null,
    lastPushedAt: updatedAt,
    daysSinceUpdate,
    owner: {
      login: repo.owner?.login,
      url: repo.owner?.html_url,
      type: repo.owner?.type,
    },
    defaultBranch: repo.default_branch,
    score: Number(score.toFixed(2)),
    reasons,
  };
}

function summarizeResult({ payload, projects, totalFetched }) {
  if (projects.length === 0) {
    return `No repositories matched "${payload.topic}" with the current filters.`;
  }

  const languages = new Set(projects.map((project) => project.language).filter(Boolean));
  const topReasons = projects
    .flatMap((project) => project.reasons?.slice(0, 1) ?? [])
    .slice(0, 3)
    .join(", ");

  const languageSummary = languages.size ? ` Focused languages: ${Array.from(languages).join(", ")}.` : "";
  const reasonSummary = topReasons ? ` Highlights: ${topReasons}.` : "";
  const maintained = payload.onlyMaintained ? " that are actively maintained" : "";

  return `Found ${projects.length} standout open-source project(s)${maintained} for "${payload.topic}".${languageSummary}${reasonSummary}`;
}

function needsDescription(project) {
  const value = typeof project.description === "string" ? project.description.trim().toLowerCase() : "";
  return (
    value.length === 0 ||
    value === "null" ||
    value === "undefined" ||
    value.startsWith("no description")
  );
}

async function fetchDescriptionFromTavily(project, topic) {
  if (!hasTavily || !project?.name) {
    return null;
  }

  try {
    const query = `${project.name} GitHub open-source project for ${topic ?? "software"} summary`;
    const response = await fetch(TAVILY_SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        max_results: 2,
        include_answer: true,
        include_images: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Tavily error ${response.status}: ${text}`);
    }

    const payload = await response.json();
    const answer = payload?.answer?.trim();
    if (answer) {
      return answer;
    }
    const content = payload?.results?.find((entry) => entry?.content)?.content?.trim();
    return content ?? null;
  } catch (error) {
    console.warn("[worker] Tavily description fetch failed", error);
    return null;
  }
}

async function fetchRepositories(payload) {
  const url = buildGitHubQuery(payload);

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 403) {
      throw new Error(
        `GitHub rate limit exceeded. ${process.env.GITHUB_TOKEN ? "Consider waiting before retrying." : "Set GITHUB_TOKEN for higher limits."}`,
      );
    }
    throw new Error(`GitHub search failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const items = Array.isArray(data.items) ? data.items : [];

  const normalized = items.map(normalizeRepo);
  normalized.sort((a, b) => b.score - a.score);
  const projects = normalized.slice(0, payload.limit);

  return {
    filters: payload,
    totalFetched: items.length,
    projects,
  };
}

async function handleJob(job) {
  const { id, payload } = job;
  await setJobStatus(id, "processing", { startedAt: new Date().toISOString(), topic: payload.topic });

  try {
    const { projects, totalFetched } = await fetchRepositories(payload);
    if (hasTavily) {
      for (const project of projects) {
        if (!needsDescription(project)) {
          continue;
        }
        const description = await fetchDescriptionFromTavily(project, payload.topic);
        if (description) {
          project.description = description;
        }
      }
    }
    const summary = summarizeResult({ payload, projects, totalFetched });

    const result = {
      status: "completed",
      summary,
      filters: payload,
      totalFetched,
      projects,
      generatedAt: new Date().toISOString(),
    };

    const resultKey = `${RESULT_PREFIX}:${id}`;
    await redis
      .multi()
      .rpush(resultKey, JSON.stringify(result))
      .expire(resultKey, RESULT_TTL_SECONDS)
      .set(
        `${JOB_METADATA_PREFIX}:${id}`,
        JSON.stringify({ status: "completed", completedAt: new Date().toISOString(), totalFetched }),
        "EX",
        RESULT_TTL_SECONDS,
      )
      .exec();
  } catch (error) {
    const resultKey = `${RESULT_PREFIX}:${id}`;
    const message = error instanceof Error ? error.message : String(error);
    await redis
      .multi()
      .rpush(
        resultKey,
        JSON.stringify({
          status: "error",
          error: message,
          filters: payload,
        }),
      )
      .expire(resultKey, RESULT_TTL_SECONDS)
      .set(
        `${JOB_METADATA_PREFIX}:${id}`,
        JSON.stringify({ status: "error", error: message, completedAt: new Date().toISOString() }),
        "EX",
        RESULT_TTL_SECONDS,
      )
      .exec();
    console.error(`[worker] Job ${id} failed:`, message);
  }
}

async function workForever() {
  console.log(`[worker] Connected to Redis at ${REDIS_URL}`);
  console.log(`[worker] Waiting for jobs on ${REQUEST_QUEUE}...`);

  while (true) {
    try {
      const response = await redis.blpop(REQUEST_QUEUE, 0);
      if (!response) {
        continue;
      }

      const [, raw] = response;
      let job;
      try {
        job = JSON.parse(raw);
      } catch (error) {
        console.error("[worker] Failed to parse job payload", error, raw);
        continue;
      }

      if (!job?.id || !job?.payload) {
        console.warn("[worker] Ignoring malformed job", job);
        continue;
      }

      await handleJob(job);
    } catch (error) {
      console.error("[worker] Unexpected loop error", error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

const shutdownSignals = ["SIGINT", "SIGTERM", "SIGQUIT"];
shutdownSignals.forEach((signal) => {
  process.on(signal, async () => {
    console.log(`\n[worker] Received ${signal}, shutting down...`);
    try {
      await redis.quit();
    } catch (error) {
      console.error("[worker] Error during Redis shutdown", error);
    } finally {
      process.exit(0);
    }
  });
});

workForever().catch((error) => {
  console.error("[worker] Fatal startup error", error);
  process.exit(1);
});
