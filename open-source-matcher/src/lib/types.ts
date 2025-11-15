export type ProjectSummary = {
  id: number;
  name: string;
  url: string;
  description?: string | null;
  homepage?: string | null;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  language?: string | null;
  topics: string[];
  license?: string | null;
  lastPushedAt?: string | null;
  daysSinceUpdate?: number;
  defaultBranch?: string;
  reasons?: string[];
  score?: number;
};

export type SearchFilters = {
  topic: string;
  language?: string;
  minStars?: number;
  onlyMaintained?: boolean;
  limit?: number;
};

export type SearchResult = {
  jobId: string;
  summary: string;
  filters: SearchFilters;
  generatedAt: string;
  totalFetched: number;
  projects: ProjectSummary[];
};

export type AgentState = {
  searches: SearchResult[];
  activeJobId?: string;
};