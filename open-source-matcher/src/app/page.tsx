"use client";

import React, { type DragEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CopilotKitCSSProperties, CopilotSidebar } from "@copilotkit/react-ui";
import { useCopilotAction } from "@copilotkit/react-core";
import { AgentState, ProjectSummary, SearchFilters, SearchResult } from "@/lib/types";
import { SearchResults } from "@/components/search-results";

function normalizeFilters(filters: unknown): SearchFilters {
  const record = typeof filters === "object" && filters !== null ? (filters as Record<string, unknown>) : {};
  return {
    topic: String(record.topic ?? "").trim(),
    language: record.language ? String(record.language).trim() : undefined,
    minStars: record.minStars != null ? Number(record.minStars) : undefined,
    onlyMaintained: Boolean(record.onlyMaintained),
    limit: record.limit != null ? Number(record.limit) : undefined,
  };
}

function normalizeProject(project: unknown): ProjectSummary {
  const data = typeof project === "object" && project !== null ? (project as Record<string, unknown>) : {};
  return {
    id: Number(data.id ?? Math.random() * 1_000_000),
    name: String(data.name ?? "Unknown project"),
    url: String(data.url ?? data.html_url ?? "#"),
    description: (data.description as string | undefined) ?? undefined,
    homepage: (data.homepage as string | undefined) ?? undefined,
    stars: Number(data.stars ?? data.stargazers_count ?? 0),
    forks: Number(data.forks ?? data.forks_count ?? 0),
    watchers: Number(data.watchers ?? data.watchers_count ?? 0),
    openIssues: Number(data.openIssues ?? data.open_issues_count ?? 0),
    language: (data.language as string | undefined) ?? undefined,
    topics: Array.isArray(data.topics) ? data.topics.map(String) : [],
    license: (data.license as string | undefined) ?? undefined,
    lastPushedAt:
      (data.lastPushedAt as string | undefined) ??
      (data.pushed_at as string | undefined) ??
      (data.updated_at as string | undefined) ??
      undefined,
    daysSinceUpdate: data.daysSinceUpdate != null ? Number(data.daysSinceUpdate) : undefined,
    defaultBranch: (data.defaultBranch as string | undefined) ?? (data.default_branch as string | undefined) ?? undefined,
    reasons: Array.isArray(data.reasons) ? data.reasons.map(String) : undefined,
    score: data.score != null ? Number(data.score) : undefined,
  };
}

function normalizeResult(result: unknown): SearchResult {
  const data = typeof result === "object" && result !== null ? (result as Record<string, unknown>) : {};
  const filters = normalizeFilters(data.filters);
  const projectsArray = Array.isArray(data.projects) ? data.projects : [];
  const projects: ProjectSummary[] = projectsArray.map(normalizeProject);

  return {
    jobId: String(data.jobId ?? crypto.randomUUID()),
    summary: String(data.summary ?? `Results for ${filters.topic}`),
    filters,
    generatedAt: (data.generatedAt as string | undefined) ?? new Date().toISOString(),
    totalFetched: Number(data.totalFetched ?? projects.length),
    projects,
  };
}

export default function OpenSourceHunterPage() {
  const [themeColor, setThemeColor] = useState("#0f172a");
  const [state, setState] = useState<AgentState>({ searches: [] });
  const [suggestions, setSuggestions] = useState<SidebarSuggestion[]>(FALLBACK_SUGGESTIONS);
  const [favoriteProjects, setFavoriteProjects] = useState<ProjectSummary[]>([]);
  const [copilotResult, setCopilotResult] = useState<SearchResult | null>(null);
  const favoritesFeed = useMemo(() => {
    if (!favoriteProjects.length) {
      return null;
    }
    return buildFavoritesFeed(favoriteProjects);
  }, [favoriteProjects]);

  const setActiveSearch = useCallback((jobId: string) => {
    setState((prev) => {
      const trimmed = jobId.trim();
      if (!trimmed) {
        return prev;
      }
      const exists = prev.searches.some((entry) => entry.jobId === trimmed);
      if (!exists || prev.activeJobId === trimmed) {
        return prev;
      }
      return { ...prev, activeJobId: trimmed };
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadFavorites() {
      try {
        const response = await fetch(`/api/favorites?limit=${FAVORITES_LIMIT}`, { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as { favorites?: unknown[] };
        if (!cancelled && Array.isArray(data.favorites)) {
          const normalized = data.favorites.map((entry) => normalizeProject(entry)).slice(0, FAVORITES_LIMIT);
          setFavoriteProjects(normalized);
        }
      } catch (error) {
        console.warn("[favorites] Failed to load favorites", error);
      }
    }
    loadFavorites();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDropResult = useCallback((payload: string) => {
    try {
      const parsed = JSON.parse(payload);
      const normalized = normalizeResult(parsed);
      setState((prev) => {
        const filtered = prev.searches.filter((entry) => entry.jobId !== normalized.jobId);
        const nextSearches = [normalized, ...filtered];
        return {
          searches: nextSearches.slice(0, 6),
          activeJobId: normalized.jobId,
        };
      });
    } catch (error) {
      console.error("Failed to import dropped result", error);
    }
  }, []);

  const rememberPrompt = useCallback(
    (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed) {
        return;
      }
      setSuggestions((prev) => {
        const next = [promptToSuggestion(trimmed), ...prev.filter((entry) => entry.message !== trimmed)];
        return next.slice(0, PROMPT_SUGGESTION_LIMIT);
      });
      fetch("/api/prompts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: trimmed }),
      }).catch((error) => {
        console.warn("[prompts] Failed to persist prompt", error);
      });
    },
    [],
  );

  const rememberFavorite = useCallback((project: ProjectSummary) => {
    const fallbackDescription =
      (typeof project.description === "string" && project.description.trim().length > 0
        ? project.description.trim()
        : project.reasons?.find((reason) => typeof reason === "string" && reason.trim())) ?? undefined;

    const sanitized: ProjectSummary = {
      ...project,
      topics: project.topics ?? [],
      reasons: project.reasons ?? [],
      description: fallbackDescription,
    };

    setFavoriteProjects((prev) => {
      const filtered = prev.filter((entry) => entry.id !== sanitized.id);
      const next = [sanitized, ...filtered].slice(0, FAVORITES_LIMIT);
      return next;
    });

    fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: sanitized }),
    }).catch((error) => {
      console.warn("[favorites] Failed to persist project", error);
    });
  }, []);

  const handleProjectSelect = useCallback(
    (project: ProjectSummary) => {
      rememberFavorite(project);
    },
    [rememberFavorite],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadPrompts() {
      try {
        const response = await fetch(`/api/prompts?limit=${PROMPT_SUGGESTION_LIMIT}`, { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as { prompts?: string[] };
        if (!cancelled && Array.isArray(data.prompts) && data.prompts.length) {
          setSuggestions(data.prompts.slice(0, PROMPT_SUGGESTION_LIMIT).map(promptToSuggestion));
        }
      } catch (error) {
        console.warn("[prompts] Failed to load prompt suggestions", error);
      }
    }
    loadPrompts();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.searches.length > 0) {
      return;
    }
    if (favoritesFeed) {
      setCopilotResult((prev) => {
        if (prev?.jobId === FAVORITES_FEED_ID && prev.totalFetched === favoritesFeed.totalFetched) {
          return prev;
        }
        return favoritesFeed;
      });
    } else {
      setCopilotResult((prev) => (prev?.jobId === FAVORITES_FEED_ID ? null : prev));
    }
  }, [favoritesFeed, state.searches.length]);

  useCopilotAction({
    name: "setThemeColor",
    description: "Adjust the dashboard accent color.",
    parameters: [
      {
        name: "themeColor",
        type: "string",
        description: "Hex color value, e.g. #0f172a.",
        required: true,
      },
    ],
    handler: ({ themeColor }) => {
      if (typeof themeColor === "string" && themeColor.startsWith("#")) {
        setThemeColor(themeColor);
      }
    },
  });

  useCopilotAction({
    name: "storeSearchResult",
    description: "Persist a search result for later reference in the dashboard.",
    parameters: [
      {
        name: "result",
        type: "object",
        required: true,
        attributes: [
          { name: "jobId", type: "string", required: true },
          { name: "summary", type: "string", required: true },
          { name: "generatedAt", type: "string", required: false },
          {
            name: "filters",
            type: "object",
            required: true,
            attributes: [
              { name: "topic", type: "string", required: true },
              { name: "language", type: "string", required: false },
              { name: "minStars", type: "number", required: false },
              { name: "onlyMaintained", type: "boolean", required: false },
              { name: "limit", type: "number", required: false },
            ],
          },
          {
            name: "projects",
            type: "object[]",
            required: true,
            attributes: [
              { name: "id", type: "number", required: false },
              { name: "name", type: "string", required: true },
              { name: "url", type: "string", required: true },
              { name: "description", type: "string", required: false },
            ],
          },
          { name: "totalFetched", type: "number", required: false },
        ],
      },
    ],
    handler: ({ result }) => {
      const normalized = normalizeResult(result);
      setState((prev) => {
        const nextSearches = [normalized, ...prev.searches.filter((entry) => entry.jobId !== normalized.jobId)];
        return {
          searches: nextSearches.slice(0, 6),
          activeJobId: normalized.jobId,
        };
      });
      if (normalized.filters.topic) {
        rememberPrompt(normalized.filters.topic);
      }
    },
  });

  useCopilotAction({
    name: "focusStoredSearch",
    description: "Swap the dashboard to display a previously stored search result.",
    parameters: [
      {
        name: "jobId",
        type: "string",
        description: "Identifier of the stored search result to focus.",
        required: true,
      },
    ],
    handler: ({ jobId }) => {
      const trimmed = typeof jobId === "string" ? jobId.trim() : "";
      if (!trimmed) {
        throw new Error("A non-empty jobId is required to focus a stored search result.");
      }
      const exists = state.searches.some((entry) => entry.jobId === trimmed);
      if (!exists) {
        throw new Error(`Unable to focus job "${trimmed}" because it is not in the stored search history.`);
      }

      setActiveSearch(trimmed);
    },
  });

  useCopilotAction(
    {
      name: "renderOpenSourceResults",
      description: "Render curated open-source projects in the dashboard UI.",
      parameters: [
        {
          name: "result",
          type: "object",
          required: true,
          attributes: [
            { name: "jobId", type: "string", required: false },
            { name: "summary", type: "string", required: false },
            { name: "generatedAt", type: "string", required: false },
            {
              name: "filters",
              type: "object",
              required: true,
              attributes: [
                { name: "topic", type: "string", required: true },
                { name: "language", type: "string", required: false },
                { name: "minStars", type: "number", required: false },
                { name: "onlyMaintained", type: "boolean", required: false },
                { name: "limit", type: "number", required: false },
              ],
            },
            {
              name: "projects",
              type: "object[]",
              required: true,
              attributes: [
                { name: "id", type: "number", required: false },
                { name: "name", type: "string", required: true },
                { name: "url", type: "string", required: true },
              ],
            },
            { name: "totalFetched", type: "number", required: false },
          ],
        },
      ],
      handler: ({ result }) => {
        const normalized = normalizeResult(result);
        setState((prev) => {
          const nextSearches = [normalized, ...prev.searches.filter((entry) => entry.jobId !== normalized.jobId)];
          return {
            searches: nextSearches.slice(0, 6),
            activeJobId: normalized.jobId,
          };
        });
        setCopilotResult(normalized);
      },
      render: ({ args }) => (
        <SearchResults result={normalizeResult(args.result)} enableDrag onProjectSelect={handleProjectSelect} />
      ),
    },
    [],
  );

  const activeResult = useMemo(() => {
    if (!state.searches.length) {
      return null;
    }
    if (state.activeJobId) {
      return state.searches.find((entry) => entry.jobId === state.activeJobId) ?? state.searches[0];
    }
    return state.searches[0];
  }, [state.searches, state.activeJobId]);

  const activeId = activeResult?.jobId;

  const previousSearches = useMemo(() => {
    if (!state.searches.length) {
      return [];
    }
    return state.searches.filter((entry) => entry.jobId !== activeId).slice(0, 6);
  }, [state.searches, activeId]);

  useEffect(() => {
    if (state.searches.length) {
      const latest = state.searches[0];
      setCopilotResult((prev) => (prev?.jobId === latest.jobId ? prev : latest));
    } else if (copilotResult && copilotResult.jobId !== FAVORITES_FEED_ID) {
      setCopilotResult(null);
    }
  }, [state.searches, copilotResult]);

  const handleSelectSearch = useCallback((jobId: string) => {
    setActiveSearch(jobId);
  }, [setActiveSearch]);

  return (
    <main style={{ "--copilot-kit-primary-color": themeColor } as CopilotKitCSSProperties}>
      <CopilotSidebar
        instructions={buildInstructionsWithFavorites(favoriteProjects)}
        labels={{
          title: "Open Source Hunter",
          initial: "👋 Ready to hunt for standout open-source projects!",
        }}
        suggestions={suggestions}
        clickOutsideToClose={false}
      >
        <Dashboard
          active={activeResult}
          history={previousSearches}
          themeColor={themeColor}
          onSelectSearch={handleSelectSearch}
          onDropResult={handleDropResult}
          copilotResult={copilotResult}
          onProjectSelect={handleProjectSelect}
        />
      </CopilotSidebar>
    </main>
  );
}

type SidebarSuggestion = {
  title: string;
  message: string;
};

const PROMPT_SUGGESTION_LIMIT = Number(process.env.NEXT_PUBLIC_PROMPT_HISTORY_LIMIT ?? 5);
const FAVORITES_LIMIT = Number(process.env.NEXT_PUBLIC_FAVORITES_LIMIT ?? 6);
const FAVORITES_FEED_ID = "favorites-feed";
const BASE_INSTRUCTIONS =
  "You are Open Source Hunter, an AI analyst that scouts, compares, and summarizes open-source projects for the user. Personalize suggestions using any stored preferences.";

const FALLBACK_SUGGESTIONS: SidebarSuggestion[] = [
  {
    title: "Find maintained libraries",
    message: "Find actively maintained TypeScript libraries for data visualization with at least 1k stars.",
  },
  {
    title: "Source Rust projects",
    message: "Identify promising Rust web frameworks with friendly documentation.",
  },
  {
    title: "DevOps focus",
    message: "Recommend open-source observability stacks that integrate with Kubernetes.",
  },
  {
    title: "Governance check",
    message: "Find Python ML repos that have a clear governance model and permissive license.",
  },
];

function promptToSuggestion(prompt: string): SidebarSuggestion {
  const trimmed = prompt.trim();
  return {
    title: trimmed.length > 40 ? `${trimmed.slice(0, 37)}…` : trimmed,
    message: trimmed,
  };
}

const HISTORY_BUTTON_TYPE: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] = "button";

function buildInstructionsWithFavorites(favorites: ProjectSummary[]): string {
  if (!favorites.length) {
    return BASE_INSTRUCTIONS;
  }

  const highlights = favorites
    .slice(0, FAVORITES_LIMIT)
    .map((project) => {
      const descriptors = [];
      if (project.language) {
        descriptors.push(project.language);
      }
      if (typeof project.stars === "number" && Number.isFinite(project.stars)) {
        descriptors.push(`${project.stars.toLocaleString()} stars`);
      }
      return `- ${project.name}${descriptors.length ? ` (${descriptors.join(", ")})` : ""}`;
    })
    .join("\n");

  return `${BASE_INSTRUCTIONS}\n\nUser recently clicked and saved these standout projects:\n${highlights}\n\nUse them as retrieval context when ranking and describing future recommendations.`;
}

function buildFavoritesFeed(projects: ProjectSummary[]): SearchResult {
  const summary =
    projects.length === 1
      ? "Saved standout project from your previous hunts"
      : `Saved ${projects.length} standout projects from your previous hunts`;

  return {
    jobId: FAVORITES_FEED_ID,
    summary,
    filters: {
      topic: "Saved favorites",
      limit: projects.length,
    },
    generatedAt: new Date().toISOString(),
    totalFetched: projects.length,
    projects,
  };
}

function Dashboard({
  active,
  history,
  themeColor,
  onSelectSearch,
  onDropResult,
  copilotResult,
  onProjectSelect,
}: {
  active: SearchResult | null;
  history: SearchResult[];
  themeColor: string;
  onSelectSearch: (jobId: string) => void;
  onDropResult: (payload: string) => void;
  copilotResult: SearchResult | null;
  onProjectSelect: (project: ProjectSummary) => void;
}) {
  const copilotTopicLabel = copilotResult?.filters.topic ?? "";
  const showCopilotFeed = Boolean(copilotResult && copilotResult.jobId !== active?.jobId);
  const showCopilotPlaceholder = !copilotResult && !active;
  const totalStored = history.length + (active ? 1 : 0);
  const showSummaryCard = Boolean(active || totalStored);

  return (
    <div
      className="min-h-screen w-full bg-slate-950"
      style={{
        backgroundImage: `radial-gradient(circle at top, ${themeColor}40 0, transparent 55%)`,
      }}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12">
        <header className="rounded-2xl bg-slate-900/70 p-8 shadow-xl ring-1 ring-slate-800/60 backdrop-blur">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-3">
              <p className="text-sm uppercase tracking-[0.3em] text-sky-300/80">Open Source Center</p>
              <h1 className="text-3xl font-semibold text-slate-100 md:text-4xl">
                Surface the right open-source projects faster
              </h1>
              <p className="max-w-2xl text-slate-300/85">
                Ask the hunter agent to scout technologies, qualify communities, and summarize trade-offs. Results are enriched
                with GitHub data and stored for decision reviews.
              </p>
            </div>
            {showSummaryCard && (
              <div className="rounded-2xl bg-slate-800/70 px-6 py-4 text-sm text-slate-300/80 shadow-inner">
                <dl className="space-y-2">
                  {active && (
                    <div className="flex items-center justify-between gap-8">
                      <dt className="uppercase tracking-wide text-slate-500">Selected search</dt>
                      <dd className="text-slate-100">{active.filters.topic}</dd>
                    </div>
                  )}
                  {totalStored > 0 && (
                    <div className="flex items-center justify-between gap-8">
                      <dt className="uppercase tracking-wide text-slate-500">History stored</dt>
                      <dd className="text-slate-100">{totalStored}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
          </div>
        </header>

        {(showCopilotFeed || showCopilotPlaceholder) && (
          <section className="space-y-4">
            <header className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500/80">Copilot feed</p>
                <h2 className="text-xl font-semibold text-slate-100">Latest AI-picked projects</h2>
              </div>
              {copilotTopicLabel ? <span className="text-xs text-slate-400">{copilotTopicLabel}</span> : null}
            </header>
            {showCopilotFeed ? (
              <SearchResults result={copilotResult} onProjectSelect={onProjectSelect} enableDrag />
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-800/80 bg-slate-900/40 px-8 py-12 text-center">
                <p className="text-sm text-slate-300/80">Run a search to populate fresh projects.</p>
              </div>
            )}
          </section>
        )}

        {active && (
          <section className="space-y-4">
            <header className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500/80">Dashboard focus</p>
                <h2 className="text-xl font-semibold text-slate-100">{active.filters.topic}</h2>
              </div>
              <span className="text-xs text-slate-400">
                {active.generatedAt ? new Date(active.generatedAt).toLocaleString() : ""}
              </span>
            </header>
            <SearchResults result={active} onProjectSelect={onProjectSelect} />
          </section>
        )}

        <HistoryPanel history={history} onSelect={onSelectSearch} />
      </div>
    </div>
  );
}

function HistoryPanel({ history, onSelect }: { history: SearchResult[]; onSelect: (jobId: string) => void }) {
  if (!history.length) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-100">Recent Hunts</h3>
        <span className="text-sm text-slate-300/80">Last {history.length} searches</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {history.map((entry) => (
          <button
            key={entry.jobId}
            type={HISTORY_BUTTON_TYPE}
            onClick={() => onSelect(entry.jobId)}
            draggable
            onDragStart={(event: React.DragEvent<HTMLButtonElement>) => {
              const payload = JSON.stringify(entry);
              event.dataTransfer.setData("application/x-open-source-hunt-result", payload);
              event.dataTransfer.setData("text/plain", payload);
              event.dataTransfer.effectAllowed = "copyMove";
            }}
            className="rounded-xl bg-slate-900/60 p-5 text-left ring-1 ring-slate-800/60 transition hover:-translate-y-0.5 hover:ring-sky-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
          >
            <header className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-slate-500">{entry.generatedAt ? new Date(entry.generatedAt).toLocaleString() : "Time unknown"}</p>
              <h4 className="text-lg font-semibold text-slate-100">{entry.filters.topic}</h4>
            </header>
            <p className="mt-2 text-sm text-slate-300/85">{entry.summary}</p>
            <dl className="mt-4 grid grid-cols-2 gap-y-2 text-xs text-slate-400/90">
              <div>
                <dt className="uppercase tracking-wide">Language</dt>
                <dd className="text-slate-200">{entry.filters.language ?? "Any"}</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide">Min stars</dt>
                <dd className="text-slate-200">{entry.filters.minStars ?? "Any"}</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide">Maintained</dt>
                <dd className="text-slate-200">{entry.filters.onlyMaintained ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide">Projects shown</dt>
                <dd className="text-slate-200">{entry.projects.length}</dd>
              </div>
            </dl>
            <span className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-sky-300/80">
              View in main panel
              <span aria-hidden={true} className="text-base leading-none">
                ↗
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
