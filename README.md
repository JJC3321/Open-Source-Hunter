# Open Source Hunter

Open Source Hunter is an end-to-end CopilotKit experience that helps you scout, vet, and compare open-source projects. A conversational frontend talks to an Express-based Copilot runtime, which coordinates with a background "Hunter" worker. The worker uses GitHub data and Redis-backed queues to surface curated project recommendations.

## Stack Overview

- **Frontend** – Next.js (App Router) with CopilotKit UI components.
- **Backend** – Node.js/Express server embedding the Copilot Runtime + Gemini adapter.
- **Worker (Hunter)** – Long-running Node.js process that consumes Redis jobs and queries the Tawily API.
- **Redis** – Shared job queue and transient datastore between the backend and worker.

```
Next.js UI  ──▶  Copilot Runtime (Express) ──▶  Redis Queue ──▶  Hunter Worker ──▶  Tawily API
             ▲                                  │                                     │
             └──────────────────── results ◀────┴────────── normalized recommendations ┘
```

## Prerequisites

- Node.js 20+
- Redis 6+ running locally (default `redis://127.0.0.1:6379`)
- Gemini API key (`GEMINI_API_KEY` or `GOOGLE_API_KEY`)
- Tavily API Key ('TAVILY_API_KEY')
- Optional GitHub token (`GITHUB_TOKEN`) for higher rate limits

## Installation

```bash
npm install
```

Create a `.env` file in the project root:

```bash
GEMINI_API_KEY=sk-...
# Optional overrides
# GEMINI_MODEL=gemini-1.5-pro
# REDIS_URL=redis://127.0.0.1:6379
# TAVILY_API_KEY = key
# NEXT_PUBLIC_COPILOTKIT_URL=http://localhost:4000/copilotkit
```

## Development

Start Redis, then run all services with a single command:

```bash
npm run dev
```

This launches:

- `next dev --turbopack` (frontend, port 3000)
- `node backend/server.mjs` (Copilot runtime, port 4000)
- `node worker/index.mjs` (Hunter worker)

Open [http://localhost:3000](http://localhost:3000) to chat with the hunter. The sidebar prompts can dispatch search jobs (`searchOpenSourceProjects`), render results, and persist past missions in the dashboard.

## Project Structure

```
backend/            Express Copilot runtime and action handlers
worker/             Hunter worker that processes search jobs
src/app/            Next.js UI pages and Copilot sidebar
src/components/     Reusable UI components (search results, history)
src/lib/types.ts    Shared TypeScript contracts between UI and agent
```

## Redis Queues

- `hunter:requests` – pending search jobs from the backend
- `hunter:results:<jobId>` – per-job response queues written by the worker
- `hunter:job:<jobId>` – ephemeral status metadata for observability

Tune queue names and TTLs with the following environment variables: `HUNTER_REQUEST_QUEUE`, `HUNTER_RESULT_PREFIX`, `HUNTER_JOB_META_PREFIX`, `HUNTER_RESULT_TTL_SECONDS`, `HUNTER_JOB_TTL_SECONDS`.

## Common Tasks

### Running only the frontend

```bash
npm run dev:ui
```

### Running the backend & worker without the UI

```bash
npm run dev:backend
npm run dev:worker
```

### Linting

```bash
npm run lint
```

## Troubleshooting

- **GEMINI_API_KEY missing** – The backend exits on startup if the key is not provided.
- **Redis connection errors** – Verify the Redis server is reachable and the `REDIS_URL` matches your environment.
- **GitHub rate limits** – Provide `GITHUB_TOKEN` to increase hourly request limits; otherwise wait a few minutes before retrying.
- **Copilot endpoint errors from Next.js** – Ensure `NEXT_PUBLIC_COPILOTKIT_URL` points to the Express server (default `http://localhost:4000/copilotkit`).

---

Built with ❤️ using [CopilotKit](https://copilotkit.ai) and the GitHub Search API.
