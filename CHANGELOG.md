# Changelog

## 0.4.0 — Agent-facing MCP interface

Closes the last major P1 gap — every P1 item from the original spec is
now ✅ or 🚧 except token usage tracking and error classification (both
noted as needing more design work, not just more time — see
[`docs/roadmap.md`](./docs/roadmap.md)).

**Added**

- `@mcp-reliable/agent-interface` — `mcp-reliable mcp` runs mcp-reliable's
  own data as an MCP server over stdio: `list_servers`,
  `get_server_health`, `list_drift_events`, `list_alerts`,
  `get_recommendation`, `list_recommendations`. The "Agent" half of the
  spec's "Dual interface (Human + Agent)" principle, alongside the
  dashboard/REST API's "Human" half.
- `@mcp-reliable/core`: `buildRecommendation` — a priority-ordered
  `avoid`/`caution`/`healthy`/`unknown` verdict synthesized from
  reachability, health score, and recent high-severity drift. New logic,
  not a repackaging of `detectHealthDegradation`.
- `redactTransport`/`serializeServer` moved from `@mcp-reliable/server`
  into `@mcp-reliable/core` — a third consumer (the agent interface)
  needed the exact same secret-redaction logic, the "rule of three"
  trigger `decisions/0006` describes for extracting shared code.
- ADR 0011 documenting the design, including a real bug found by
  actually spawning `mcp-reliable mcp` as a process and driving it with a
  real MCP client: the store was closing immediately after the initial
  handshake (before any tool call could run), because
  `server.connect(transport)` resolves on handshake completion, not
  session end. The `InMemoryTransport`-based unit tests never exercise
  the CLI's store-lifecycle wiring, so they didn't catch it — this is the
  second time in this project a bug only showed up once something was run
  for real end to end (the first being the Node 20 issue, ADR 0009).
- 34 new tests (163 → 193): `core`'s redaction and recommendation logic,
  and every agent-interface tool via a real MCP `Client` connected over
  the SDK's `InMemoryTransport` — genuine protocol round trips, no MCP
  mocking, no process spawned.

## 0.3.0 — Webhook and Slack alerting

Closes the last major P1 gap. See [`docs/roadmap.md`](./docs/roadmap.md)
for full status.

**Added**

- `@mcp-reliable/notifier` — `WebhookNotifier` (generic JSON), `SlackNotifier`
  (Slack incoming-webhook format), and `CompositeNotifier` (fans out to
  both, isolating failures between them), behind a single `Notifier`
  interface. Neither notifier ever sends a full `Server` object — only
  `{id, name}` — for the same reason the REST API redacts transport
  secrets.
- `@mcp-reliable/core`: `detectHealthDegradation` (transition-based —
  alerts on crossing into/within a worse health-score band, not on every
  tick a server stays degraded) and `driftEventToAlert`.
- `mcp-reliable monitor --webhook <url>` / `--slack-webhook <url>` /
  `--window <ms>`: now reconciles and delivers all three `Alert` kinds
  every tick (unreachable, health-degradation, drift), not just
  unreachable. Also now persists a trailing-window health score every
  tick, further densifying the dashboard's history chart as a side effect.
- `mcp-reliable proxy --webhook <url>` / `--slack-webhook <url>`: delivers
  drift alerts from **live** traffic in real time, not just at the next
  scheduled `monitor` check.
- ADR 0010 documenting the alerting design, including a real
  notification-loss race condition found during manual testing (a
  fire-and-forget webhook call could be lost if the proxy process exited
  before the request completed) and its fix: `proxy` now tracks in-flight
  notifications and awaits them (with a timeout) on every shutdown path,
  natural or `SIGINT`/`SIGTERM` — which also fixed a related,
  previously-unhandled gap where a killed proxy could orphan its wrapped
  child process.
- 38 new tests (125 → 163): `core`'s alert-generation logic,
  `notifier`'s three implementations (against an injected fake `fetch`,
  no real network calls), and the CLI's full alert-reconciliation surface.

## 0.2.1 — Fix: Node 20 CI failure (reference server spawned as unbuilt .ts)

Caught by CI on the Node 20.x matrix job. See
[`docs/decisions/0009-reference-server-must-be-built-for-tests.md`](./docs/decisions/0009-reference-server-must-be-built-for-tests.md)
for the full account.

**Fixed**

- The collector's integration tests, the reference server's own `bin`/
  `start` entries, and every CLI/getting-started example spawning the
  reference server now use its **built** `dist/index.js` instead of
  `src/index.ts` directly. The original approach relied on Node's
  built-in TypeScript type-stripping, which only exists on Node 22.6+ —
  this project supports Node 20+ (per its own `package.json` engines
  field and CI matrix), and Node 20 crashed outright
  (`ERR_UNKNOWN_FILE_EXTENSION`) trying to load a `.ts` file as a child
  process, failing all 7 affected tests (5 in `proxy-collector.test.ts`,
  2 in `health-checker.test.ts`) on that Node version.
- Added `packages/collector/test/helpers/ensure-reference-server-built.ts`,
  which builds the reference server once, lazily, the first time an
  integration test needs it — preserving the "`npm test` needs no manual
  build first" property for every other package.

## 0.2.0 — Web dashboard

Closes the one remaining P0 gap from 0.1.0. See
[`docs/roadmap.md`](./docs/roadmap.md) for full status.

**Added**

- `@mcp-reliable/dashboard` — a Vite + React 19 + Tailwind v4 web
  dashboard: a fleet overview (dense, terminal-styled status list) and a
  per-server detail page (health-score readout, health-history chart,
  per-tool breakdown, drift/alert timeline, recent-executions log). Visual
  identity is grounded in the CLI's existing terminal aesthetic rather
  than a generic dashboard template — see
  `docs/decisions/0008-dashboard-stack-and-duplication.md`.
- `@mcp-reliable/server`: a new `GET /api/servers/health-summary` batch
  endpoint (health for every server in one call), a `lastHealthCheck`
  field distinguishing "reachable right now" from the windowed
  `reachabilityRate`, and static-file serving for the built dashboard
  (`packages/server/src/static.ts`), with graceful degradation if the
  dashboard hasn't been built.
- 21 new tests (104 → 125): the new REST endpoint and static-mounting
  helper, and the dashboard's formatting/threshold and per-tool
  aggregation logic.
- ADR 0008 documenting the dashboard's stack deviation (hand-rolled
  Tailwind over shadcn/ui — its CLI needs registry network access this
  environment doesn't allow), hash-based routing (avoids needing SPA
  fallback middleware), and the browser/Node type-duplication decision
  (`@mcp-reliable/core` isn't browser-safe as a whole, since
  `fingerprint.ts` imports `node:crypto`).

**Known gaps carried forward:** per-tool aggregation is still client-side
only (no dedicated server-side endpoint), no component-rendering tests for
the dashboard, SSE/HTTP still unsupported by the traffic-observing proxy.
See `docs/roadmap.md`.

## 0.1.0 — Initial P0 foundation

First implementation pass against `mcp-reliable-project-spec.md`. See
[`docs/roadmap.md`](./docs/roadmap.md) for the full status table against
the spec's P0/P1/P2 feature lists; summary of what's new since there was no
prior version:

**Added**

- `@mcp-reliable/core` — data model (Server/Tool/Execution/HealthScore/
  DriftEvent/Alert), schema and output-shape fingerprinting, the health
  score formula, schema and output-shape drift detection.
- `@mcp-reliable/storage` — `ReliabilityStore` interface + a SQLite
  (`better-sqlite3`) implementation.
- `@mcp-reliable/collector` — `HealthChecker` (pull-based, never invokes a
  tool) and `StdioProxyCollector` (transparent traffic-observing proxy for
  stdio servers).
- `@mcp-reliable/cli` — `mcp-reliable init|add-server|remove-server|servers|monitor|report|proxy`.
- `@mcp-reliable/server` — a REST API (Hono) over everything above, with
  transport-secret redaction.
- `examples/reference-mcp-server` — a 3-tool stdio MCP server (echo, add,
  flaky) used by the integration test suite and the getting-started guide,
  including a built-in demo-mode switch for triggering schema/output drift
  on demand.
- Full documentation set under `docs/` (architecture, data model, CLI/API
  reference, getting-started, testing strategy, dashboard design doc, 7
  ADRs) plus this roadmap.
- CI (GitHub Actions): lint, type-check/build, and test on Node 20.x and
  22.x.
- 104 tests across every package, including integration tests that spawn
  the reference server as a real process rather than mocking the MCP
  protocol.

**Known gaps** (see `docs/roadmap.md` for the complete list): no web
dashboard yet (design-only), SSE/HTTP not supported by the traffic-
observing proxy (only pull-based health checks), no statistical drift
detection, no token-usage tracking, no webhook/Slack alerting, no
agent-facing MCP interface.
