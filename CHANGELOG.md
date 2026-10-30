# Changelog

## 1.2.2 — Report the real version

### Fixed

- `mcp-reliable --version` printed `1.0.0` in every release since 1.0.0.
  It now reads the CLI package's own `package.json`.
- The agent interface reported version `1.0.0` to MCP clients, and the
  health checker sent `1.0.0` as its client version to monitored servers.
  Both now report their package's real version.

### Changed

- Internal `@mattral/*` dependency ranges raised to `^1.2.2`.
- `PUBLISHING.md`: releases are published only from the WSL checkout, and
  the smoke test checks the `--version` output.

## 1.2.1 — Packaging fix for the 1.2.0 publish

No code changes from 1.2.0; install this one instead. See
`RELEASE_NOTES_v1.2.1.md` for the full account.

### Fixed

- 1.2.0 of `@mattral/core`, `storage`, `collector`, `notifier`, and
  `agent-interface` was published from an unbuilt clone and contains no
  `dist/` code. Those versions are deprecated on npm, and `latest` was
  moved back to 1.1.0 until this release. `@mattral/server` and
  `mcp-reliable` were never published at 1.2.0.

### Changed

- Every published package runs its build in `prepublishOnly`, so a
  publish without installed dependencies fails instead of shipping an
  empty tarball. `@mattral/server` builds before copying the dashboard.
- `npm run release:publish` runs `npm run release:check` first.
- Internal `@mattral/*` dependency ranges raised from `^1.0.0` to
  `^1.2.1`.
- `PUBLISHING.md` starts from `npm ci` and records this incident.

## 1.2.0 — Dependency security fixes, v1 scope closure

A maintenance release. No new features; `mcp-reliable` is now
feature-complete for v1 and in maintenance mode — see
[`decisions/0017-v1-scope-closure.md`](./docs/decisions/0017-v1-scope-closure.md).

### Dependencies

`npm audit` went from 20 findings (4 critical, 9 high) to **0**, across
runtime and dev dependencies. See `docs/testing.md#dependency-audit-status`
for each change and why.

- `@modelcontextprotocol/sdk` minimum raised to `^1.32.2`.
- `zod` `^3.24.1` → `^4.6.7` (`GHSA-mrhx-c7xc-m3w5` has no 3.x fix).
- `vitest` / `@vitest/coverage-v8` `^2.1.8` → `^4.1.12` (dev only; 4.x
  keeps Node 20 support).
- `package-lock.json` regenerated.

**Compatibility note:** `@mattral/core` exports its data-model schemas
(`ServerSchema`, `TransportConfigSchema`, and the rest of `types.ts`),
which are now zod 4 schemas. Their inferred TypeScript types and
`.parse()` behavior are unchanged, and nothing else in this repository
needed a source change. If you embed them inside your own zod 3 schemas,
move to zod 4 as well. This is why the release is 1.2.0 rather than a
patch.

### Fixed

- The `v1.0.0` git tag now points at the commit actually published to npm
  as 1.0.0. It had been on a separate line of history with no common
  ancestor with `main` — see the "Resolution" section of ADR 0014.
- `README.md` no longer lists statistical drift detection as unbuilt
  (latency drift shipped in 1.1.0), and points at every release's notes
  rather than only 1.0.0's.
- Roadmap, `SECURITY.md`, `docs/architecture.md`, and `docs/testing.md`
  updated to the current dependency-audit and tag status.

### Documentation

- ADR 0017: v1 scope closure — what's out of scope, why, and what would
  reopen it. `docs/roadmap.md` marks those items accordingly.
- `PUBLISHING.md` step 5 adds a `git merge-base --is-ancestor` check, the
  one that would have caught the `v1.0.0` tag problem.

## 1.1.0 — Statistical drift detection, error classification, and post-1.0 hardening

Every published package's `README.md` was also added this release — none
had one before, so none showed anything on their npm package page.

### Dependencies

`npm audit fix` (non-breaking) applied, resolving seven findings that had
appeared since 1.0.0 (`@hono/node-server`, `brace-expansion`, `fast-uri`,
`hono`, `ip-address`, `postcss`). Two findings remain, both unreachable in
this project's actual usage — see `docs/testing.md#dependency-audit-status`.

### Error classification

See
[`decisions/0016-error-classification.md`](./docs/decisions/0016-error-classification.md)
for the full account, including a third instance of the same bug pattern
found in the statistical drift detection pass.

**Added**

- `classifyError` / `summarizeErrorCategories`: a fixed taxonomy
  (rate-limit, auth, not-found, timeout, validation, connection,
  server-error, unknown) for grouping `Execution` failures by likely
  cause, via ordered regex pattern matching.
- `mcp-reliable report` gained an "Errors, by likely cause" section.
- The agent interface's `get_server_health` tool gained `errorSummary` —
  an agent can now see *why* a server is degraded, not just its score.

**Fixed**

- Proxy-observed tool-level failures (`result: {isError: true, content:
  [...]}`) had their real error text discarded in favor of one generic
  placeholder string, regardless of what the tool actually said —
  verified live (15 calls to a tool that fails ~25% of the time produced
  3 failures, all three recorded identically). Fixed via a new
  `extractErrorMessage` helper
  (`packages/collector/src/error-message.ts`).

**Deliberately not done this pass:** a dashboard visualization for the
error breakdown, and folding error-category context into
`buildRecommendation` — both flagged as clean, well-scoped follow-ups
rather than rushed in. See the ADR.

### Statistical drift detection

See
[`decisions/0015-statistical-drift-detection.md`](./docs/decisions/0015-statistical-drift-detection.md)
for the full account, including two pre-existing bugs found and fixed
along the way.

**Added**

- `detectLatencyDrift`: a new `"statistical"` drift kind (`metric:
  "latency"`) comparing successful calls' latency *distributions* between
  a baseline and recent window via a two-sample Kolmogorov-Smirnov test —
  catches durable latency shifts that stay under `computeHealthScore`'s
  fixed p95 threshold. KS-test p-value approximation verified against
  `scipy.stats.ks_2samp` across 2,000 randomized trials before shipping.
- `drift_events` gained a `metric` column (this project's first real
  schema migration, `SCHEMA_VERSION` 1 → 2, tested against a real
  pre-migration database file).
- `StdioProxyCollector` gained `driftCheckIntervalCalls` and
  `driftWindowSize` options controlling how often and over how large a
  window output-shape/statistical drift get checked.
- `examples/reference-mcp-server` gained `MCP_RELIABLE_ARTIFICIAL_DELAY_MS`
  for reproducing a controlled latency shift in tests/demos.

**Fixed**

- `detectOutputShapeDrift` was fully built and unit-tested but never
  actually wired into any running code path — the roadmap's "tested
  against a real server" claim described manual testing, not anything
  the shipped code or automated suite exercised. Now wired into
  `StdioProxyCollector` alongside the new latency detector.
- Output signatures were computed over MCP's transport-level `content`
  wrapper instead of the tool's actual output — `[{type:"text",
  text:"..."}]` has the same shape regardless of what JSON is embedded in
  `text`, so output-shape drift could never have caught a real change.
  Fixed via a new `extractOutputPayload` helper
  (`packages/collector/src/output-payload.ts`) that unwraps
  `structuredContent` or parses a single JSON text block before signing.

### Post-1.0 hardening pass

See
[`decisions/0014-post-1.0-hardening-pass.md`](./docs/decisions/0014-post-1.0-hardening-pass.md)
for the full account of each item below.

**Fixed / Added**

- `mcp-reliable monitor` gained a `--timeout <ms>` flag exposing
  `HealthChecker`'s previously-hard-coded connection timeout (default
  10s). Extracted the shared `parsePositiveMs` validation helper in the
  process — the third call site (`--interval`/`--window`/`--timeout`)
  needing identical parsing logic, per ADR 0006's "rule of three."
- `packages/server` gained a `start` script (`npm run start` → `node
  dist/index.js`) — previously only runnable via that exact direct
  invocation.
- `PUBLISHING.md`'s post-publish smoke-test example no longer assumes a
  Unix shell (`/tmp/...`); now gives macOS/Linux, PowerShell, and
  `cmd.exe` versions.
- `PUBLISHING.md` documents a known, harmless npm CLI warning
  ([npm/cli#7302](https://github.com/npm/cli/issues/7302)) seen during
  publish, and adds tag-verification guidance to the tag/push step.
- `README.md` now links directly to the live npm packages and carries
  the same "verified live" framing `RELEASE_NOTES_v1.0.0.md` already had.

**Investigated, documented, not code-changed**

- Confirmed the `v1.0.0` git tag on the real GitHub remote is stale —
  points six commits behind `HEAD`, before the `@mcp-reliable` →
  `@mattral` scope rename. Fix commands recorded in `PUBLISHING.md`;
  actually running them needs the maintainer's own GitHub write access.
- Re-ran `npm audit` and traced all four current advisories to their
  actual reachability (previously only one, `esbuild`, was documented).
  Three of the four are confirmed not exploitable in this project's real
  usage — see `docs/testing.md#dependency-audit-status`. No dependency
  version changes made; nothing here was actually reachable at runtime.

## 1.0.0 — First stable release

Every publishable package moves to `1.0.0` together (see
[`docs/decisions/0012-v1-release-preparation.md`](./docs/decisions/0012-v1-release-preparation.md)
for why lockstep, not independent, versioning). See
[`RELEASE_NOTES_v1.0.0.md`](./RELEASE_NOTES_v1.0.0.md) for the full,
narrative version of this release; this entry covers what changed
mechanically since 0.4.0.

**Changed**

- Every scoped package publishes under `@mattral/` (was `@mcp-reliable/`)
  — the originally planned `@mcp-reliable` npm organization turned out to
  already be taken when actually creating it, unrelated to whether any
  code existed there. Personal npm scopes need no such creation step, so
  publishing moved to the maintainer's own `@mattral` scope instead. Past
  changelog entries below describe the repository as it actually was at
  each point in its history and are left as `@mcp-reliable/*`, matching
  what `package.json` really said at those commits — see
  [`docs/decisions/0013-npm-scope-rename.md`](./docs/decisions/0013-npm-scope-rename.md).
- The CLI package is now published unscoped as `mcp-reliable` (was
  `@mcp-reliable/cli`) — matches its own `bin` entry and the original
  spec's `npx mcp-reliable init` framing. Nothing else in the repo
  depended on the old scoped name.
- `@mattral/server` now bundles the dashboard's built output into
  itself at publish time (`prepublishOnly` → `scripts/copy-dashboard.mjs`),
  fixing a real gap: a standalone `npm install @mattral/server`
  (outside this monorepo) previously could never find the dashboard at
  all, since npm doesn't preserve monorepo sibling directories. Verified
  by simulating a standalone install (hiding the monorepo sibling
  directory) and confirming the bundled copy gets served instead.
- Every publishable package gained real npm metadata (`repository`,
  `homepage`, `bugs`, `author`, `keywords`, `engines`, `files`,
  `publishConfig.access: "public"`) — none of this mattered before nothing
  had been published.
- 2 new tests (193 → 195): `resolveDashboardDist`'s bundled-vs-sibling
  fallback logic.

**Added**

- `PUBLISHING.md` — the exact, verified mechanical release checklist
  (npm scope setup, publish order, tagging, GitHub release).
- `RELEASE_NOTES_v1.0.0.md` — this release's announcement-style writeup.
- ADR 0012 documenting every decision above, including the
  dashboard-bundling bug found while preparing to actually publish, and
  ADR 0013 documenting the npm scope rename specifically.

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
