 "use client";

import React, { type DragEvent } from "react";
import { ProjectSummary, SearchResult } from "@/lib/types";
import Link from "next/link";

function formatDate(dateString?: string | null) {
  if (!dateString) return "Unknown";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatNumber(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function ProjectCard({ project, onProjectSelect }: { project: ProjectSummary; onProjectSelect?: (project: ProjectSummary) => void }) {
  const description =
    (typeof project.description === "string" && project.description.trim().length > 0
      ? project.description.trim()
      : project.reasons?.[0]) ?? "No description provided.";
  const scoreValue = typeof project.score === "number" && Number.isFinite(project.score) ? project.score.toFixed(1) : null;
  const languageValue = project.language?.trim();
  const lastUpdated = formatDate(project.lastPushedAt);
  const metaItems = [
    scoreValue ? `Score ${scoreValue}` : null,
    languageValue ?? null,
    lastUpdated !== "Unknown" ? `Updated ${lastUpdated}` : null,
  ].filter(Boolean);

  const numericStats = [
    { label: "Stars", value: project.stars },
    { label: "Forks", value: project.forks },
    { label: "Watchers", value: project.watchers },
    { label: "Open issues", value: project.openIssues },
  ].filter((item) => Number(item.value) > 0);

  return (
    <div
      className="rounded-xl bg-slate-900/60 p-5 shadow-lg ring-1 ring-slate-800/60 backdrop-blur"
      onClick={() => onProjectSelect?.(project)}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Link
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-lg font-semibold text-sky-300 hover:text-sky-200"
          >
            {project.name}
          </Link>
          <p className="text-sm text-slate-300/80">{description}</p>
        </div>
        {metaItems.length > 0 && (
          <div className="flex flex-col items-end text-right text-sm text-slate-300/80">
            {metaItems.map((item) => (
              <span key={item} className="font-semibold text-slate-100 first:text-slate-100">
                {item}
              </span>
            ))}
          </div>
        )}
      </div>

      {(numericStats.length > 0 || project.license || project.defaultBranch) && (
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-300/90">
          {numericStats.map((stat) => (
            <StatPill key={stat.label} label={stat.label} value={formatNumber(Number(stat.value))} />
          ))}
          {project.license && <StatPill label="License" value={project.license} />}
          {project.defaultBranch && <StatPill label="Default branch" value={project.defaultBranch} />}
        </div>
      )}

      {(project.topics?.length ?? 0) > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {project.topics!.map((topic) => (
            <span key={topic} className="rounded-full bg-sky-500/10 px-3 py-1 text-xs text-sky-200">
              #{topic}
            </span>
          ))}
        </div>
      )}

      {(project.reasons?.length ?? 0) > 0 && (
        <div className="mt-4 space-y-1 border-l-2 border-slate-800/80 pl-4 text-sm text-slate-200/90">
          {project.reasons!.map((reason, index) => (
            <p key={index}>{reason}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-800/80 px-3 py-1">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-slate-100">{value}</span>
    </span>
  );
}

type SearchResultsProps = {
  result: SearchResult;
  enableDrag?: boolean;
  onProjectSelect?: (project: ProjectSummary) => void;
};

export function SearchResults({ result, enableDrag = false, onProjectSelect }: SearchResultsProps) {
  const handleDragStart = (event: DragEvent<HTMLElement>) => {
    if (!enableDrag) {
      return;
    }
    const payload = JSON.stringify(result);
    event.dataTransfer.setData("application/x-open-source-hunt-result", payload);
    event.dataTransfer.setData("text/plain", payload);
    event.dataTransfer.effectAllowed = "copyMove";
  };

  return (
    <section
      className="space-y-6"
      draggable={enableDrag}
      onDragStart={handleDragStart}
    >
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">{result.summary}</h2>
            <p className="text-sm text-slate-300/80">
              Generated {new Date(result.generatedAt).toLocaleString()} · Source: GitHub Search API
            </p>
          </div>
          <FilterSummary filters={result.filters} />
        </div>
        {enableDrag && (
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Drag this block into the dashboard drop zone to pin these projects.
          </p>
        )}
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {result.projects.map((project) => (
          <ProjectCard key={project.id} project={project} onProjectSelect={onProjectSelect} />
        ))}
      </div>
    </section>
  );
}

function FilterSummary({ filters }: { filters: SearchResult["filters"] }) {
  return (
    <dl className="grid grid-cols-2 gap-y-1 gap-x-4 rounded-xl bg-slate-900/80 px-4 py-3 text-xs text-slate-300/80 md:grid-cols-4">
      <div>
        <dt className="uppercase tracking-wide text-slate-500">Topic</dt>
        <dd className="text-slate-100">{filters.topic}</dd>
      </div>
      <div>
        <dt className="uppercase tracking-wide text-slate-500">Language</dt>
        <dd className="text-slate-100">{filters.language ?? "Any"}</dd>
      </div>
      <div>
        <dt className="uppercase tracking-wide text-slate-500">Min stars</dt>
        <dd className="text-slate-100">{filters.minStars ?? "Any"}</dd>
      </div>
      <div>
        <dt className="uppercase tracking-wide text-slate-500">Maintained</dt>
        <dd className="text-slate-100">{filters.onlyMaintained ? "Yes" : "No"}</dd>
      </div>
    </dl>
  );
}
