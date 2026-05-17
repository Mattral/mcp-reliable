# Web Dashboard — Design Doc (not yet implemented)

Status: **planned, not built**. This document exists so the next milestone
starts from a real design rather than a blank page — see
[`roadmap.md`](./roadmap.md) for where this sits relative to everything
else. Everything below is a proposal; treat it as a starting point for
implementation, not a description of shipped behavior.

## Why this is next

The spec lists a "Basic web dashboard" under P0 ("View current health and
recent executions"). Every other P0 item is implemented; this is the one
piece of P0 not yet built, specifically because it's a genuinely different
kind of work (frontend, not data/protocol engineering) and benefited from
having the REST API it depends on fully built and stable first — which is
now the case (`api-reference.md`).

## Goals

- A single human, glancing at one screen, should be able to tell: which
  servers are healthy, which aren't, and whether anything just started
  drifting.
- Zero additional setup beyond what's already required to run the REST API
  (`node packages/server/dist/index.js`) — the dashboard should be static
  assets the same server can serve, not a second process to run.
- Read-only for v1 (no server registration/removal from the UI — that
  stays a CLI action, at least initially, consistent with "Developer Joy"
  favoring a fast CLI loop over clicking through forms for setup).

## Proposed stack

Per the original spec's technical stack table: **React + Tailwind +
shadcn/ui**, built with Vite, served as static files by the existing Hono
app (`app.get('/*', serveStatic(...))` from `@hono/node-server/serve-static`,
added alongside the existing `/api/*` routes in `packages/server/src/app.ts`
— no new process).

## Proposed views

### 1. Fleet overview (`/`)

A card or table per registered server: name, a colored status dot (green/
yellow/red, same thresholds as `formatScore` in the CLI —
`colorForScore` in `packages/cli/src/format.ts` — reused here for visual
consistency between the CLI and the dashboard), current tool health score,
reachability, and a small badge if there's an unresolved alert or recent
drift. Sourced from `GET /api/servers` + one `GET /api/servers/:id/health`
call per server (or a new batch endpoint — see "API additions needed"
below).

### 2. Server detail (`/servers/:id`)

- Header: name, transport summary (redacted, same as the API), tags.
- Health score over time: a line chart from `GET /api/servers/:id/health-history`.
  This is the first UI consumer of the `health_scores` table that
  `buildServerReport`/the `/health` endpoint have been populating since
  P0 — see `data-model.md#healthscore`.
- Per-tool breakdown: success rate and p95 latency per tool name, computed
  client-side from `GET /api/servers/:id/executions` (or a new
  server-side aggregation endpoint if the executions list gets large
  enough that shipping every row to the browser stops being reasonable —
  see below).
- Recent executions table: timestamp, tool, duration, success/fail,
  truncated output signature.
- Drift timeline: `GET /api/servers/:id/drift`, newest first, colored by
  severity (reusing `formatSeverity`'s color mapping).
- Alerts: `GET /api/servers/:id/alerts`, with a manual "mark resolved"
  action once a `PATCH`/`POST` endpoint exists for it (today, alerts only
  auto-resolve via `monitor`'s reconciliation loop — see
  `data-model.md#alert`).

## API additions needed before/alongside the dashboard

The REST API as it stands (`api-reference.md`) is sufficient to build the
above, but two additions would make the fleet overview meaningfully more
efficient once there's more than a handful of servers:

1. `GET /api/servers/health-summary` — health for *every* server in one
   call, instead of N calls to `/api/servers/:id/health`.
2. Per-tool aggregation server-side (`GET /api/servers/:id/tools/:name/health`
   or similar) rather than shipping raw executions to the browser to
   aggregate client-side, once execution volume is high enough to matter.

Neither blocks starting the dashboard; both are worth doing before treating
the fleet-overview page as "production-grade" for anything beyond a
handful of servers.

## Explicit non-goals for v1

- Multi-user auth / RBAC (P2 in the original spec: "Team features:
  Sharing, RBAC, and collaboration (later stage)").
- Editing alert rules or drift thresholds from the UI (the health-score
  weights and drift-dominance thresholds are currently code-level defaults
  in `@mcp-reliable/core` — see `decisions/0005-health-score-formula.md`).
- Real-time push updates (polling the REST API on an interval is
  sufficient for v1; a WebSocket/SSE live feed is a reasonable later
  addition once the static-view dashboard exists and someone's actually
  asked for it).
