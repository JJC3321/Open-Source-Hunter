# Open Source Hunter Architecture

## Overview

The application is composed of four cooperating services that turn a natural-language request into curated open-source project recommendations:

- **Next.js + CopilotKit Frontend** (`/src/app`)
  - Presents the Copilot sidebar, captures user intent, and renders structured summaries returned by the backend.
  - Exposes frontend-only Copilot actions for rendering project results and tracking the on-page state shared with the assistant.
- **Copilot Backend (Express)** (`/backend/server.mjs`)
  - Hosts the CopilotKit runtime and exposes `/copilotkit` as a GraphQL endpoint consumed by the frontend.
  - Defines server-side Copilot actions (e.g. `searchOpenSourceProjects`) that enqueue work for the Hunter worker and return structured data to the LLM.
- **Hunter Worker** (`/worker/index.mjs`)
  - Long-running Node.js process that consumes search jobs from Redis, queries the GitHub API, and publishes normalized project metadata back to Redis.
  - Adds lightweight ranking heuristics (awesomeness score, maintenance freshness, contributor velocity) before returning results.
- **Redis**
  - Serves as the shared queue and transient datastore between the backend and worker (`hunter:requests`, `hunter:results:<jobId>`).
  - Provides at-least-once delivery semantics with configurable TTLs and timeouts.

## Message Flow

1. The Copilot agent receives a user question (e.g. "Find actively maintained Rust web frameworks").
2. The LLM invokes the `searchOpenSourceProjects` Copilot action.
   - The backend enqueues `{ jobId, topic, filters }` into `hunter:requests` and blocks on `hunter:results:<jobId>`.
3. The Hunter worker `BLPOP`s the pending job, queries GitHub (optionally with a `GITHUB_TOKEN`), normalizes & ranks projects, and pushes the result payload to `hunter:results:<jobId>`.
4. The backend action receives the payload, clears the temporary key, and returns the structured result to the calling LLM.
5. The LLM composes a conversational answer and triggers the `renderOpenSourceResults` frontend action so the user sees an interactive project list.

## Environment Variables

All services honor the same `.env` file placed at the repository root:

- `GEMINI_API_KEY` – required for the Copilot runtime Gemini adapter (alias: `GOOGLE_API_KEY`).
- `GEMINI_MODEL` *(optional)* – defaults to `gemini-1.5-pro`.
- `REDIS_URL` *(optional)* – defaults to `redis://127.0.0.1:6379`.
- `SEARCH_TIMEOUT_MS` *(optional)* – backend wait timeout, default `20000`.
- `GITHUB_TOKEN` *(optional)* – increases GitHub API rate limits for the worker.

Configure separate process managers (e.g. `npm run dev`) to launch the frontend, backend, and worker concurrently during development.
