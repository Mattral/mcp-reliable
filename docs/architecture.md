# Architecture

This document describes how `mcp-reliable` is actually built today. For what's
planned but not yet built, see [`roadmap.md`](./roadmap.md) and
[`dashboard-design.md`](./dashboard-design.md). For *why* particular choices
were made, see [`decisions/`](./decisions/).

## Package map

`mcp-reliable` is an npm-workspaces monorepo. Each package has a single
responsibility and depends only on the packages below it in this list —
there are no cycles.

```
@mcp-reliable/core        pure data model, health scoring, drift detection (no I/O)
@mcp-reliable/storage     SQLite persistence, implements the ReliabilityStore interface
@mcp-reliable/collector   HealthChecker (pull) + StdioProxyCollector (traffic-observing)
@mcp-reliable/notifier    webhook and Slack delivery for alerts
@mcp-reliable/agent-interface   agent-facing MCP tools (health, drift, alerts, recommendations)
@mcp-reliable/cli         `mcp-reliable` command-line tool
@mcp-reliable/server      REST API over stored data, and serves the built dashboard as static assets
@mcp-reliable/dashboard   React + Tailwind web dashboard (fleet overview + server detail), built to static assets consumed by @mcp-reliable/server
examples/reference-mcp-server   a tiny 3-tool stdio MCP server used by tests and the getting-started guide
```

See [`decisions/0001-monorepo-and-package-boundaries.md`](./decisions/0001-monorepo-and-package-boundaries.md)
for why the boundaries are drawn here specifically.

`core` has zero runtime dependencies besides `zod` and never touches the
filesystem, network, or a database — every algorithm in it (schema
fingerprinting, output-shape signatures, health scoring, drift detection) is
a pure function over plain data, which is what makes it possible to unit
test the actual reliability math without spinning up SQLite or a child
process.

## Collection model

The spec's original design doc posed an open question: pull-based collection
(health checks) vs. push-based (server self-instruments). `mcp-reliable`
implements a third option that gets most of the benefit of both without
requiring the server to add any code: **a traffic-observing proxy**.

### 1. Health checks (`HealthChecker`, pull-based)

`HealthChecker.check(server)` connects to a server as a real MCP client,
completes the `initialize` handshake, calls `tools/list`, and disconnects.
It **never calls a tool**. This is a deliberate safety boundary (spec
section 11: *"Never execute tools without explicit user consent in
monitoring mode"*) — a monitoring tool has no way to know that calling an
arbitrary tool with synthetic arguments is safe (it could send an email,
charge a card, delete a file), so it simply doesn't.

What a health check *does* give you: reachability, round-trip latency for
the handshake + tool listing, the current tool schemas (for schema-drift
detection), and nothing else. Every health check records a pseudo-`Execution`
under the reserved tool name `__health_check__` with `source: "health-check"`,
which is why reporting code (`buildServerReport` in the CLI, and the
`/api/servers/:id/health` endpoint) always separates "reachability" (from
health checks) from "tool health score" (from real traffic) — see
[`data-model.md`](./data-model.md#health-vs-reachability).

### 2. Traffic-observing proxy (`StdioProxyCollector`, "push" without instrumentation)

`mcp-reliable proxy <server-id> -- <command> [args...]` spawns the real
server as a child process and becomes a transparent stdio pass-through: every
JSON-RPC message the real client sends is forwarded byte-for-byte to the
child, and every message the child sends back is forwarded byte-for-byte to
the client. The client's launch configuration simply points at
`mcp-reliable proxy ...` instead of the original command — the wrapped
server's source code is never touched.

While forwarding, the proxy also:

- matches `tools/call` requests to their responses (by JSON-RPC `id`) to
  record an `Execution` — real duration, success/failure, an output-shape
  signature, and byte-size proxies for input/output
- matches `tools/list` requests to their responses to update each `Tool`'s
  schema fingerprint, running schema-drift detection on every observed list

Because every recorded call was one a real client actually made, there is no
consent question here the way there is for health checks — `mcp-reliable`
never originates a tool call itself in this mode.

```
   real MCP client                mcp-reliable proxy                  real MCP server
  (agent / IDE / etc)         (StdioProxyCollector)                  (child process)
         │                              │                                   │
         │  JSON-RPC over stdio         │                                   │
         ├─────────────────────────────►│                                   │
         │                              │  forwarded verbatim               │
         │                              ├──────────────────────────────────►│
         │                              │                                   │
         │                              │◄──────────────────────────────────┤
         │◄─────────────────────────────┤  forwarded verbatim               │
         │                              │                                   │
         │                     records Execution / Tool / DriftEvent
         │                     into SQLite as a side effect, on the
         │                     way through — the client sees no
         │                     added latency-affecting logic beyond
         │                     JSON parsing and a synchronous DB write
```

Message framing is newline-delimited JSON (the wire format the MCP stdio
transport itself uses), reimplemented directly in
`packages/collector/src/json-rpc-framer.ts` rather than depending on SDK
internals that aren't part of its public API.

### Why not just push-based instrumentation?

The original spec left "should we support direct instrumentation (push)"
as an open question. Requiring every MCP server author to add an SDK and
wire up telemetry calls is exactly the adoption friction the project's
"Production First" and "Developer Joy" principles are meant to avoid. The
proxy gets real traffic data with a one-line launch-command change and no
code change to the server at all. Direct in-process instrumentation (an SDK
a server author imports) remains a reasonable **future opt-in** for
high-scale users who want to avoid an extra process hop — tracked in
[`roadmap.md`](./roadmap.md) — but it is not required to get value from
`mcp-reliable` today.

## Transport adapters

`Server.transport` is a discriminated union: `stdio` (command/args/env/cwd),
`sse`, or `http` (streamable HTTP). `HealthChecker` uses the official
`@modelcontextprotocol/sdk` client transports for all three (see
`packages/collector/src/transport-factory.ts`). `StdioProxyCollector` only
supports `stdio` today, because "transparently wrap this network connection"
for SSE/HTTP is a materially different (and not yet implemented) problem —
tracked in `roadmap.md`.

## Storage

A single `ReliabilityStore` interface (`packages/storage/src/store.ts`)
describes everything the rest of the system needs from persistence:
servers, tools, executions, drift events, health-score snapshots, and
alerts. `SqliteStore` is the only implementation today. See
[`decisions/0002-storage-engine.md`](./decisions/0002-storage-engine.md) for
why SQLite (via `better-sqlite3`) was chosen as the default, and what would
justify adding a PostgreSQL-backed implementation of the same interface
later without touching any other package.

## Health scoring and drift detection

Both live in `@mcp-reliable/core` as pure functions over arrays of
`Execution`/`DriftEvent` records — see
[`data-model.md`](./data-model.md#health-scoring) and
[`data-model.md`](./data-model.md#drift-detection) for the algorithms
themselves, and [`decisions/0005-health-score-formula.md`](./decisions/0005-health-score-formula.md)
for the reasoning behind the formula (including a real bug found and fixed
during development — see that ADR's "Revision" section).

## Alerting

`Alert` records (`health-degradation`, `drift`, `unreachable`) are created
by the CLI, not by `core` or `storage` directly:

- `mcp-reliable monitor` reconciles all three kinds every tick —
  `reconcileUnreachableAlert` (reachability, open/resolve), a new
  `reconcileHealthDegradationAlert` (a fresh trailing-window health score
  compared against the previous one on record, via `core`'s
  `detectHealthDegradation` — open/resolve on band transitions only, not
  every tick a server stays degraded), and `recordDriftAlerts` (one alert
  per schema-drift event the health check just found; no "resolved" state,
  since drift is a point-in-time fact, not an ongoing condition).
- `mcp-reliable proxy` also creates drift alerts, from *live* traffic
  drift (its `onDrift` callback) — a schema change caught mid-production,
  not just at the next scheduled check.

Delivery is a separate concern, `@mcp-reliable/notifier`: a `Notifier`
interface with `WebhookNotifier` (generic JSON) and `SlackNotifier`
(Slack incoming-webhook format) implementations, composable via
`CompositeNotifier`. Neither ever sends a full `Server` object over the
wire — only `{id, name}`, for the same reason the REST API redacts
transport secrets. See
[`decisions/0010-alerting-notifier-design.md`](./decisions/0010-alerting-notifier-design.md)
for the full design, including a real notification-loss race condition
found (and fixed) during development, and why alerting only lives in the
CLI today — the REST API reads `Alert` records but doesn't create or
deliver them.

## REST API and dashboard

`@mcp-reliable/server` wraps a `ReliabilityStore` in a small Hono app
(`packages/server/src/app.ts`) exposing servers, tools, executions, drift
events, health scores, and alerts as JSON over HTTP, plus a batch
`GET /api/servers/health-summary` for the dashboard's fleet view. The same
process also serves `@mcp-reliable/dashboard`'s built static assets
(`packages/server/src/static.ts`, mounted only if the dashboard has been
built — the API works standalone otherwise).

## Agent interface

`@mcp-reliable/agent-interface` is the "Agent" half of the spec's "Dual
interface (Human + Agent)" principle — the dashboard/REST API serve
humans, this serves MCP clients directly. `mcp-reliable mcp` runs it over
stdio: six tools (`list_servers`, `get_server_health`,
`list_drift_events`, `list_alerts`, `get_recommendation`,
`list_recommendations`) covering the same data the REST API exposes, plus
a synthesized `avoid`/`caution`/`healthy`/`unknown` recommendation per
server (`core`'s `buildRecommendation`) that neither the REST API nor the
dashboard currently surface directly. Point an agent's MCP client
configuration at `mcp-reliable mcp` the same way `mcp-reliable proxy`
wraps a real server's launch command — see `docs/cli-reference.md`.

Transport secrets are redacted the same way as the REST API
(`core`'s `serializeServer`, extracted from `server` into `core` once a
third consumer needed it — see
[`decisions/0011-agent-interface-design.md`](./decisions/0011-agent-interface-design.md)).
Unlike the REST API's `/health` endpoint, the agent interface's health
queries never persist a `HealthScore` snapshot — an agent might query
before every tool call it's considering, a very different access pattern
from a human running `report` on a schedule; see that same ADR for the
full reasoning, plus a real "the store closed before any tool call could
run" bug found by actually spinning up a real client against a real
spawned process, not just the (still valuable, still passing)
`InMemoryTransport`-based unit tests.

## Security posture (spec §11)

- The CLI and REST API only ever bind to `localhost` by default (the server
  package's `serve()` call does not set a `hostname`, which `@hono/node-server`
  defaults to a loopback-safe bind — see its docs before exposing this
  beyond a single machine).
- `HealthChecker` never invokes a tool (see above).
- The REST API redacts `env`/header *values* (not keys) from any transport
  config before it's serialized to JSON — see `packages/server/src/serialize.ts`
  — because server registrations routinely carry API keys in `env`.
- Malformed JSON-RPC lines observed by the proxy are forwarded verbatim
  rather than dropped or thrown on, so a single corrupt message can't take
  down a live session — but they are also not parsed for telemetry, so they
  simply don't produce an `Execution` record.
- No dependency in the runtime path (as opposed to the dev/test toolchain)
  had a known vulnerability at time of writing — see
  [`testing.md`](./testing.md#dependency-audit-status) for the one flagged
  dev-dependency issue and why it doesn't affect shipped code.
