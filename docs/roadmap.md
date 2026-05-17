# Roadmap

Status as of this writing, tracked against the feature tables in the
original project spec (`mcp-reliable-project-spec.md`, §8). This file is
meant to be kept current — update it alongside any feature work, per the
spec's own instruction to document every major update.

Legend: ✅ done and tested · 🚧 partially done · ⬜ not started

## P0 — Foundation (MVP)

| Feature | Status | Notes |
|---|---|---|
| Health monitoring | ✅ | `HealthChecker` (pull-based, never calls a tool) + `monitor` command. |
| Per-tool metrics (success rate, p50/p95, error rate) | ✅ | `computeHealthScore`; per-tool breakdown exists in report data but the CLI `report` command currently prints server-level, not per-tool, numbers — see "Near-term" below. |
| Basic drift detection (schema + output signature) | ✅ | `detectSchemaDrift` + `detectOutputShapeDrift`, both tested against a real server across two sessions. |
| Clean CLI (`monitor`, `report`, `add-server`) | ✅ | Plus `init`, `servers`, `remove-server`, `proxy` (needed to actually generate real traffic data — see `architecture.md#collection-model`). |
| Local-first storage (SQLite, zero config) | ✅ | `SqliteStore`, `.mcp-reliable/data.sqlite` convention. |
| stdio + SSE support | 🚧 | `HealthChecker` supports stdio/SSE/HTTP for pull-based checks. The traffic-observing proxy (`StdioProxyCollector`) supports **stdio only** — an SSE/HTTP proxy is a materially different problem (there's no "child process" to sit in front of) and isn't built yet. |
| Basic web dashboard | ⬜ | Design complete (`dashboard-design.md`); not implemented. The REST API it depends on is fully built and tested. |

## P1 — Production Readiness

| Feature | Status | Notes |
|---|---|---|
| Behavioral drift detection (statistical comparison) | ⬜ | P0 shipped a structural (shape-only) detector; true statistical comparison of output *values* or latency *distributions* is not built — see `decisions/0007-drift-detection-v0-scope.md`. |
| Token usage tracking | ⬜ | `Execution.inputBytes`/`outputBytes` are byte-size proxies, explicitly not token counts (see `data-model.md#execution`) — real token tracking needs a tokenizer matched to the calling agent's model, which mcp-reliable has no way to know today. |
| Error classification | ⬜ | `Execution.errorMessage` is stored verbatim; there's no grouping/clustering of common failure modes yet. |
| Multi-server fleet view | 🚧 | `servers`/`monitor`/`report` all operate over every registered server already; there's no dashboard fleet view yet (see P0 dashboard gap above). |
| Webhook + Slack alerting | ⬜ | `Alert` records are created/resolved (`reconcileUnreachableAlert`) and queryable via the REST API and would back this, but no outbound webhook/Slack integration exists yet. |
| Full MCP interface (agents can query health/drift) | ⬜ | The REST API (`api-reference.md`) has everything an MCP tool wrapper would need to call into; the MCP-facing tool surface itself isn't built. |
| Historical trends | 🚧 | Data model and persistence exist (`HealthScore` snapshots via `recordHealthScore`/`listHealthScores`, exercised by every `report` run and by `/api/servers/:id/health-history`); there's no chart/UI consuming it yet (planned in `dashboard-design.md`). |

## P2 — Advanced Capabilities

All ⬜ — none started. Per the spec: cost optimization engine, custom rule
engine, OpenTelemetry exporter, ML-based anomaly detection, team features
(sharing/RBAC).

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

## Known limitations to fix soon (not spec gaps, just rough edges)

- `monitor`'s polling loop uses one shared `--interval` for every selected
  server rather than honoring each server's own `healthCheckIntervalMs`
  (which is currently stored but not enforced).
- `add-server` has no way to pass per-check environment variable overrides
  for comparing two schema versions of the same server id — the
  getting-started guide's drift demo works around this by registering a
  second server id instead (see `getting-started.md` step 6).
- The `cli` and `server` packages each independently resolve the DB path
  convention (small, deliberate duplication — see
  `decisions/0006-server-config-duplication.md`), which is worth revisiting
  if a third consumer of that convention shows up.
- `npm audit` flags a dev-only `esbuild`/`vitest` advisory — see
  `testing.md#dependency-audit-status`.
