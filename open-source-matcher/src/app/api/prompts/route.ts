import { getRedisClient } from "@/lib/redis";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROMPT_HISTORY_KEY = process.env.HUNTER_PROMPT_HISTORY_KEY ?? "hunter:prompts";
const PROMPT_HISTORY_LIMIT = Number(process.env.HUNTER_PROMPT_HISTORY_LIMIT ?? 6);

export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = Math.min(Number(limitParam ?? PROMPT_HISTORY_LIMIT) || PROMPT_HISTORY_LIMIT, 15);

  try {
    const redis = getRedisClient();
    const prompts = await redis.lrange(PROMPT_HISTORY_KEY, 0, limit - 1);
    return NextResponse.json({ prompts });
  } catch (error) {
    console.error("[prompts] Failed to load prompts from Redis", error);
    return NextResponse.json({ prompts: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: unknown = {};

  try {
    body = await request.json();
  } catch (error) {
    console.error("[prompts] Failed to parse POST body", error);
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const prompt = typeof (body as any)?.prompt === "string" ? (body as any).prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 422 });
  }

  try {
    const redis = getRedisClient();
    await redis
      .multi()
      .lrem(PROMPT_HISTORY_KEY, 0, prompt)
      .lpush(PROMPT_HISTORY_KEY, prompt)
      .ltrim(PROMPT_HISTORY_KEY, 0, PROMPT_HISTORY_LIMIT - 1)
      .exec();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[prompts] Failed to store prompt in Redis", error);
    return NextResponse.json({ error: "Failed to store prompt." }, { status: 500 });
  }
}

