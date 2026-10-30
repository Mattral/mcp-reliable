# Roadmap

Status as of this writing, tracked against the feature tables in the
original project spec (`mcp-reliable-project-spec.md`, §8). This file is
meant to be kept current — update it alongside any feature work, per the
spec's own instruction to document every major update.

**Status: feature-complete for v1, in maintenance mode** (as of 1.2.0).
Everything still ⛔/🚧 below is deliberately out of scope for v1, not
pending work — see
[`decisions/0017-v1-scope-closure.md`](./decisions/0017-v1-scope-closure.md)
for the reasoning item by item, and for what would reopen any of them.

**v1.0.0 shipped** with everything marked ✅ below through the agent
interface (see [`RELEASE_NOTES_v1.0.0.md`](../RELEASE_NOTES_v1.0.0.md)).
P2 in particular was framed by the original spec itself as "Advanced
Capabilities," later-stage work, not part of the release-readiness bar.

**Post-1.0 hardening pass** (see
[`decisions/0014-post-1.0-hardening-pass.md`](./decisions/0014-post-1.0-hardening-pass.md)):
confirmed and documented a stale `v1.0.0` git tag (since fixed — it now
points at the commit published to npm as 1.0.0), re-verified
the full dependency audit rather than trusting the old single-advisory
note, added `monitor --timeout`, a `start` script for `@mattral/server`,
and cross-platform fixes to `PUBLISHING.md`.

Legend: ✅ done and tested · 🚧 partially done (remainder out of scope for v1) · ⛔ out of scope for v1

## P0 — Foundation (MVP)

| Feature | Status | Notes |
|---|---|---|
| Health monitoring | ✅ | `HealthChecker` (pull-based, never calls a tool) + `monitor` command. |
| Per-tool metrics (success rate, p50/p95, error rate) | ✅ | `computeHealthScore`; per-tool breakdown exists in report data but the CLI `report` command currently prints server-level, not per-tool, numbers; the dashboard's per-tool breakdown table covers it (see "Known limitations" below). |
| Basic drift detection (schema + output signature) | ✅ | `detectSchemaDrift` + `detectOutputShapeDrift`. Correction: at v1.0.0, `detectOutputShapeDrift` was fully built and unit-tested but never actually wired into any running code path, and the output-signature computation it depends on was hashing MCP's transport envelope instead of the real tool output — both fixed in `decisions/0015-statistical-drift-detection.md`. Now genuinely verified end-to-end against a real server. |
| Clean CLI (`monitor`, `report`, `add-server`) | ✅ | Plus `init`, `servers`, `remove-server`, `proxy` (needed to actually generate real traffic data — see `architecture.md#collection-model`). |
| Local-first storage (SQLite, zero config) | ✅ | `SqliteStore`, `.mcp-reliable/data.sqlite` convention. |
| stdio + SSE support | 🚧 | `HealthChecker` supports stdio/SSE/HTTP for pull-based checks. The traffic-observing proxy (`StdioProxyCollector`) supports **stdio only** — an SSE/HTTP proxy is a materially different problem (there's no "child process" to sit in front of). Out of scope for v1 (ADR 0017). |
| Basic web dashboard | ✅ | `packages/dashboard` — fleet overview + server detail, served as static assets by `@mattral/server`. See `dashboard-design.md` for what shipped vs. the original plan, and `decisions/0008-dashboard-stack-and-duplication.md` for the implementation decisions. |

## P1 — Production Readiness

| Feature | Status | Notes |
|---|---|---|
| Behavioral drift detection (statistical comparison) | 🚧 | Latency *distribution* drift shipped — a two-sample KS test comparing baseline/recent windows, see `decisions/0015-statistical-drift-detection.md`. Statistical comparison of output *values* is still not built — deliberately deferred, since it needs a data-retention decision (extracting and storing real numeric values from tool outputs) this project hasn't made, not just an engineering pass. Output-value drift is out of scope for v1 (ADR 0017). |
| Token usage tracking | ⛔ | `Execution.inputBytes`/`outputBytes` are byte-size proxies, explicitly not token counts (see `data-model.md#execution`) — real token tracking needs a tokenizer matched to the calling agent's model, which mcp-reliable has no way to know today. Out of scope for v1 (ADR 0017). |
| Error classification | ✅ | `classifyError` + `summarizeErrorCategories`, surfaced via `mcp-reliable report` and `get_server_health`. Found and fixed a bug along the way: proxy-observed tool-level failures' real error text was being discarded for a generic placeholder — see `decisions/0016-error-classification.md`. Not yet in the dashboard (deliberate scope boundary, not a gap). |
| Multi-server fleet view | ✅ | The dashboard's fleet overview (`/`) lists every registered server with live status; `servers`/`monitor`/`report` also already operate over every registered server. |
| Webhook + Slack alerting | ✅ | `@mattral/notifier` (`WebhookNotifier`, `SlackNotifier`, `CompositeNotifier`), wired into both `monitor` (`--webhook`/`--slack-webhook`) and `proxy` (live-traffic drift). All three `Alert` kinds are now actively produced — see `data-model.md#alert` and `decisions/0010-alerting-notifier-design.md`. |
| Full MCP interface (agents can query health/drift) | ✅ | `@mattral/agent-interface`, run via `mcp-reliable mcp` (stdio). Six tools covering health, drift, alerts, and synthesized recommendations — see `decisions/0011-agent-interface-design.md`. stdio only, matching the traffic-observing proxy's transport scope; HTTP/SSE is out of scope for v1 (ADR 0017). |
| Historical trends | ✅ | `HealthScore` snapshots (`recordHealthScore`/`listHealthScores`) now have a consumer: the dashboard's health-history line chart (`GET /api/servers/:id/health-history`), populated by every `report` run or `/health` call. |

## P2 — Advanced Capabilities

⛔ Out of scope for v1 — none started (ADR 0017). Per the spec: cost
optimization engine, custom rule engine, OpenTelemetry exporter, ML-based
anomaly detection, team features (sharing/RBAC).

## Open questions from the spec — current answers

1. **Push vs. pull in v1?** Resolved with a third option: a traffic-
   observing stdio proxy that requires no server-side code change (see
   `architecture.md#collection-model` and
   `decisions/0003-collection-model.md`). Direct in-process instrumentation
   (true push) remains a possible future opt-in, not yet built.
2. **How aggressive should early drift detection be?** Deliberately
   conservative: output-shape drift requires a minimum sample size (5) and
   dominance threshold (60%) in both windows before it reports anything —
   see `data-model.md#drift-detection`. Schema drift has no such threshold
   (any fingerprint change is reported at `high` severity) since it's a
   structural fact, not a statistical inference.
3. **Should the project include an agent that can act on reliability
   signals (e.g. disable a degraded tool)?** Not built, and not currently
   planned as a default behavior — `mcp-reliable` observes and reports; it
   does not intervene in traffic. If this is wanted later, it would need
   to be a deliberate, clearly-scoped opt-in given the safety implications
   of software autonomously disabling tools an agent might depend on.
4. **Should mcp-reliable store actual output *values* for statistical
   comparison, not just shape/size?** Deliberately not decided yet.
   Latency-distribution drift (the other half of the P1 "statistical
   comparison" spec item) shipped without this, since latency needs no new
   stored data. Output-value drift would — extracting and persisting real
   numeric values from tool outputs, which nothing in this system does
   today, and which has real privacy surface (see
   `decisions/0015-statistical-drift-detection.md`). Needs a scoping
   conversation (which fields, what depth, what retention) before it's
   worth writing code against.

## Known limitations (not spec gaps, just rough edges)

Documented rough edges. None blocks v1 use; they're the natural starting
points if active development ever resumes.

- `monitor`'s polling loop uses one shared `--interval` for every selected
  server rather than honoring each server's own `healthCheckIntervalMs`
  (which is currently stored but not enforced). Note: the connection
  *timeout* (separate from the polling interval) is configurable as of
  this pass via `monitor --timeout <ms>` — this remaining item is only
  about per-server polling cadence, not the timeout.
- `add-server` has no way to pass per-check environment variable overrides
  for comparing two schema versions of the same server id — the
  getting-started guide's drift demo works around this by registering a
  second server id instead (see `getting-started.md` step 6).
- The dashboard's per-tool breakdown table aggregates client-side from a
  sample of recent executions rather than a dedicated server-side
  aggregation endpoint — fine up to a few hundred calls, not built for
  scale yet (see `dashboard-design.md`'s API-additions status).
- The dashboard uses hash-based routing (`/#/servers/:id`) rather than
  clean path-based URLs, a deliberate tradeoff to avoid needing SPA
  fallback routing in `@mattral/server` — see
  `decisions/0008-dashboard-stack-and-duplication.md`.
- Alerting configuration (`--webhook`/`--slack-webhook`) is CLI-flag-only,
  per-invocation — there's no persisted, per-server notification config,
  and the REST API doesn't create or deliver alerts at all (it only reads
  what the CLI has recorded). See `decisions/0010-alerting-notifier-design.md`.
- Health-degradation and drift thresholds (`DEFAULT_HEALTH_DEGRADATION_THRESHOLDS`,
  the output-shape drift dominance/sample-size defaults, and the new
  latency-drift `minSampleSize`/`alpha`/`minRelativeShift`) are code-level
  constants, not configurable per server yet — same gap the P2 "custom
  rule engine" item is meant to eventually close.
- Output-shape and statistical (latency) drift need a full
  `driftWindowSize * 2` (default 40) successful calls to a given tool
  before the *first* check is even attempted — low-traffic tools may go a
  while before either detector has enough data to say anything. Schema
  drift has no such floor (it's a single fingerprint compare). See
  `decisions/0015-statistical-drift-detection.md`.
- The `cli` and `server` packages each independently resolve the DB path
  convention (small, deliberate duplication — see
  `decisions/0006-server-config-duplication.md`), which is worth revisiting
  if a third consumer of that convention shows up.
