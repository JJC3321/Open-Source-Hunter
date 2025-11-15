import { getRedisClient } from "@/lib/redis";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAVORITES_KEY = process.env.HUNTER_FAVORITES_KEY ?? "hunter:favorites";
const FAVORITES_LIMIT = Number(process.env.HUNTER_FAVORITES_LIMIT ?? 8);

type FavoriteProject = {
  id: number;
  name: string;
  url: string;
  description?: string | null;
  summary?: string | null;
  tags?: string[];
  language?: string | null;
  stars?: number;
};

function sanitizeProject(data: unknown): FavoriteProject | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  const id = Number(record.id ?? Math.random() * 1_000_000);
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const urlRaw = record.url ?? record.html_url ?? "#";
  const url = typeof urlRaw === "string" ? urlRaw : "#";

  if (!name || !url) {
    return null;
  }

  const description =
    (typeof record.description === "string" && record.description.trim().length > 0
      ? record.description.trim()
      : Array.isArray(record.reasons)
        ? record.reasons.find((reason) => typeof reason === "string" && reason.trim())?.trim()
        : undefined) ?? undefined;

  const summary =
    (typeof record.summary === "string" && record.summary.trim().length > 0 ? record.summary.trim() : description) ??
    undefined;

  return {
    id,
    name,
    url,
    description,
    summary,
    tags: Array.isArray(record.tags) ? record.tags.map(String) : undefined,
    language: typeof record.language === "string" ? record.language : undefined,
    stars: typeof record.stars === "number" ? record.stars : Number(record.stargazers_count ?? 0),
  };
}

export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = Math.min(Number(limitParam ?? FAVORITES_LIMIT) || FAVORITES_LIMIT, 12);

  try {
    const redis = getRedisClient();
    const raw = await redis.lrange(FAVORITES_KEY, 0, limit - 1);
    const favorites: FavoriteProject[] = raw
      .map((entry) => {
        try {
          return JSON.parse(entry) as FavoriteProject;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is FavoriteProject => Boolean(entry));

    return NextResponse.json({ favorites });
  } catch (error) {
    console.error("[favorites] Failed to load favorites from Redis", error);
    return NextResponse.json({ favorites: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { project?: unknown };
    const project = sanitizeProject(body.project);
    if (!project) {
      return NextResponse.json({ error: "Invalid project payload." }, { status: 422 });
    }

    const redis = getRedisClient();
    const serialized = JSON.stringify(project);
    await redis
      .multi()
      .lrem(FAVORITES_KEY, 0, serialized)
      .lpush(FAVORITES_KEY, serialized)
      .ltrim(FAVORITES_KEY, 0, FAVORITES_LIMIT - 1)
      .exec();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[favorites] Failed to store favorite project", error);
    return NextResponse.json({ error: "Failed to store favorite project." }, { status: 500 });
  }
}

