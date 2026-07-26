# Web Dashboard

Status: **implemented** (`packages/dashboard`). This document was originally
written as a pre-implementation design doc; it's kept below (lightly
edited) as the record of what was planned, followed by what actually
shipped and where it deviated. See [`roadmap.md`](./roadmap.md) for how
this fits against everything else, and
[`decisions/0008-dashboard-stack-and-duplication.md`](./decisions/0008-dashboard-stack-and-duplication.md)
for the specific technical decisions (stack deviation, hash routing,
type/logic duplication) in ADR form.

## What shipped

- `packages/dashboard`: a Vite + React 19 + Tailwind v4 single-page app,
  built to static assets and served by `@mattral/server` at `/` —
  exactly the "no new process" goal below. Run `npm run build` (root, or
  specifically in `packages/dashboard`) then
  `node packages/server/dist/index.js`; the server logs whether it found a
  built dashboard to serve.
- **Fleet overview** (`/`): a dense, terminal-styled status list (not a
  card grid — see the ADR for why), one row per server: status dot, name,
  health score, reachability, p95 latency, drift count. Polls
  `GET /api/servers/health-summary` (the batch endpoint proposed below —
  built) every 15s. Clicking a row navigates to its detail page.
- **Server detail** (`/#/servers/:id`): status + transport + tags header, a
  large monospace health-score readout with a colored underline (the
  signature element, deliberately not a circular gauge), a health-history
  line chart (recharts), a per-tool breakdown table, a combined drift+alert
  timeline, and a terminal-log-styled recent-executions list.
- Visual identity is grounded in the CLI's existing terminal aesthetic
  (dark canvas, monospace-forward type for data, the same green/amber/red
  score thresholds as `packages/cli/src/format.ts`) rather than a generic
  dashboard template — see the ADR for the full token system.
- Routing is hash-based (`/#/servers/xyz`), specifically so the server
  needs no SPA-fallback route — every request it sees is either `/` or a
  real static asset.
- The `ServerDetail` route (and its `recharts` dependency) is code-split via
  `React.lazy`, so the more frequently visited fleet overview loads a
  ~77KB gzipped bundle rather than pulling in the charting library it
  doesn't need.

## Deviations from the original plan (below)

- **Stack**: shadcn/ui was proposed; hand-rolled Tailwind components
  shipped instead — see the ADR (same category of reasoning as the CLI's
  Ink deviation, ADR 0004, plus the shadcn CLI needing registry network
  access this environment didn't have).
- **Data model reuse**: the plan didn't anticipate that `@mattral/core`
  isn't browser-safe as a whole (`fingerprint.ts` imports `node:crypto`).
  The dashboard declares its own mirrored types and re-implements the score/
  severity color thresholds rather than importing `core` directly — see the
  ADR.
- **`lastHealthCheck`**: added to the health-summary/health responses
  beyond what was originally scoped — the fleet view's status dot needed
  "is it reachable *right now*" (the latest check), which is different
  from `reachabilityRate` (a 24h aggregate); see
  `data-model.md#health-vs-reachability` for why these stay separate
  fields rather than being collapsed into one.

## Original design goals

- A single human, glancing at one screen, should be able to tell: which
  servers are healthy, which aren't, and whether anything just started
  drifting.
- Zero additional setup beyond what's already required to run the REST API
  — the dashboard is static assets the same server serves, not a second
  process to run.
- Read-only for v1 (no server registration/removal from the UI — that
  stays a CLI action, consistent with "Developer Joy" favoring a fast CLI
  loop over clicking through forms for setup). Still true as shipped.

## API additions proposed here — status

1. `GET /api/servers/health-summary` — **built**. Health (+ `lastHealthCheck`,
   unresolved alert count, recent drift count) for every server in one call.
2. Per-tool aggregation server-side (`GET /api/servers/:id/tools/:name/health`
   or similar) — **not built**. The shipped `ToolBreakdownTable` aggregates
   client-side from a sample of recent executions
   (`packages/dashboard/src/lib/tool-stats.ts`), which is fine up to a few
   hundred calls and not a substitute for real server-side aggregation once
   traffic volume grows — tracked in `roadmap.md`.

## Explicit non-goals (still true as shipped)

- Multi-user auth / RBAC (P2 in the original spec).
- Editing alert rules or drift thresholds from the UI (still code-level
  defaults in `@mattral/core` — see
  `decisions/0005-health-score-formula.md`).
- Real-time push updates (15s polling, not a WebSocket/SSE live feed — a
  reasonable later addition if someone actually asks for it).
- Registering/removing servers from the UI (CLI-only, by design — see goals
  above).
