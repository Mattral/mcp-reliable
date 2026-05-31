# Data Model

All types below are defined with `zod` schemas in `packages/core/src/types.ts`
(so they're both a compile-time type and a runtime-validatable schema) and
persisted by `@mcp-reliable/storage` in the SQLite tables shown.

## Entities

### Server

A registered MCP server to monitor.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable identifier, used everywhere else as a foreign key. The CLI slugifies `--name` into this by default. |
| `name` | string | Human-readable label. |
| `transport` | `TransportConfig` | `{type: "stdio", command, args, env?, cwd?}` \| `{type: "sse", url, headers?}` \| `{type: "http", url, headers?}` |
| `tags` | string[] | Free-form, for filtering in future multi-server views. |
| `createdAt` | epoch ms | |
| `healthCheckIntervalMs` | number | Metadata today (see the honesty note in `architecture.md` — the v0 `monitor` loop polls all selected servers on one shared interval, it does not yet schedule each server independently by this field). |

SQLite table: `servers`. `transport` and `tags` are stored as JSON text
columns (`transport_json`, `tags_json`) — see
[`decisions/0002-storage-engine.md`](./decisions/0002-storage-engine.md) for
why nested config is stored as JSON rather than normalized into more tables.

### Tool

A tool exposed by a server, as most recently observed by a health check or
the proxy.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `serverId` | string | |
| `name` | string | Unique per `(serverId, name)` — enforced by a SQLite `UNIQUE` constraint. |
| `description` | string? | |
| `schemaFingerprint` | string | SHA-256 of the canonicalized input JSON schema. See "Schema drift" below. |
| `inputSchema` | unknown | The raw schema, kept for inspection/diffing later. |
| `firstSeenAt` / `lastSeenAt` | epoch ms | `firstSeenAt` is set once on first insert and never overwritten by later upserts. |

SQLite table: `tools`.

### Execution

One observed tool invocation.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `serverId` | string | |
| `toolName` | string | For health checks, always the reserved value `__health_check__`. |
| `startedAt` | epoch ms | |
| `durationMs` | number | |
| `success` | boolean | `false` if the JSON-RPC response had a top-level `error`, or `result.isError === true`. |
| `errorMessage` | string? | |
| `outputSignature` | string? | Structural signature of the output (see "Output-shape drift" below). Only set for successful, proxy-observed calls. |
| `inputBytes` / `outputBytes` | number? | Best-effort size proxies. **Not token counts** — computing real token counts needs a tokenizer matched to whatever model the calling agent uses, which `mcp-reliable` has no way to know; see `roadmap.md` for token-usage tracking as a still-open P1 item. |
| `source` | `"proxy" \| "health-check"` | See [`architecture.md#collection-model`](./architecture.md#collection-model). |

SQLite table: `executions`, indexed on `(server_id, started_at)` and
`(server_id, tool_name, started_at)` for the range queries `report` and the
REST API run.

### HealthScore

A computed, persisted snapshot — not derived on every read. Every time the
CLI's `report` command or the `/api/servers/:id/health` endpoint computes a
score, it calls `store.recordHealthScore(...)`, so a history accumulates in
the `health_scores` table (`PRIMARY KEY (server_id, window_start, window_end)`,
so recomputing the same window updates it in place). This is what will back
the "historical trends" view once it has a UI (see `roadmap.md`).

### DriftEvent

A detected change. `kind` is `"schema"` or `"output-shape"`; `severity` is
`"low" | "medium" | "high"`. See "Drift detection" below.

### Alert

A notification-worthy event. Today, only the `monitor` command's
`reconcileUnreachableAlert` produces these (opens a `critical`/`unreachable`
alert on the first unreachable check, resolves it once the server recovers,
never duplicates while already open). Health-degradation and drift-based
alerts, and any outbound notification (webhook/Slack), are P1 —
see `roadmap.md`.

## Health vs. reachability

A server can be:

- **reachable, with no health score** — registered and responding to health
  checks, but no agent has actually used it through `mcp-reliable proxy` yet.
  There's simply no tool-call data to score.
- **unreachable, with a stale health score** — the last time an agent used it
  through the proxy it looked fine, but it's down right now.

`buildServerReport` (CLI) and `/api/servers/:id/health` (REST API) both
report these as two separate fields for exactly this reason — collapsing
them into one number would hide which of "nobody's using it" and "it's
broken" you're looking at.

A related, narrower distinction lives inside "reachable" itself:
`reachabilityRate` (used by `report` and the REST API) is a windowed
*aggregate* — the fraction of health checks that succeeded over, say, the
last 24h — while `lastHealthCheck` (REST API and the dashboard's status
dot only) is the single most recent check's result. A server that was
flaky yesterday but has been fine for the last hour has a middling
`reachabilityRate` and a `lastHealthCheck.success` of `true` — the fleet
dashboard's live status dot deliberately uses the latter, since "is it up
right now" is a different question than "how has it been over the last
day," and conflating them would make a recovered server look falsely
degraded on the one view meant to show current state at a glance.

## Health scoring

Implemented in `packages/core/src/health-score.ts`, given a window of
`Execution` records (and, optionally, `DriftEvent`s that fall in the same
window):

```
successRate   = successCount / sampleCount
latencyScore  = clamp01(1 - (p95Ms - goodMs) / (badMs - goodMs))   // 1.0 at/below goodMs (default 500ms), 0.0 at/above badMs (default 5000ms)
weightedBlend = successWeight * 1 + latencyWeight * latencyScore    // successWeight=0.65, latencyWeight=0.35 by default
base          = 100 * successRate * weightedBlend
score         = clamp(base - min(sum(driftPenalty[severity] for each event), maxDriftPenalty), 0, 100)
```

The key design choice: **`successRate` multiplicatively gates the score**,
it isn't just one term in a weighted average. A server failing 100% of
calls scores exactly 0 no matter how fast those failures return — "fails
instantly" isn't a meaningfully healthier state than "fails slowly" when
nothing succeeds. Within whatever ceiling `successRate` sets, latency still
shifts the score: at 100% success, the range is `successWeight * 100`
(worst-case p95) to `100` (best-case p95). See
[`decisions/0005-health-score-formula.md`](./decisions/0005-health-score-formula.md)
for the full derivation, default values, and a real bug this exact reasoning
caught during development.

Percentiles use the simple "nearest rank" method (sort ascending, take the
value at `ceil(p/100 * n)`), documented in `packages/core/src/stats.ts` — no
interpolation, chosen so results are easy to reproduce by hand for a v0
scorer.

## Drift detection

Two independent detectors, both pure functions in
`packages/core/src/drift.ts`:

### Schema drift

`computeSchemaFingerprint(schema)` canonicalizes a JSON schema (recursively
sorts object keys; array order is preserved since it's usually meaningful)
and SHA-256 hashes the result, so two structurally-identical schemas always
fingerprint identically regardless of key order, and any real change
(a type change, a required field added/removed) changes the hash.
`detectSchemaDrift` compares a tool's previously stored fingerprint to a
newly observed one and, if different, emits a `high`-severity `DriftEvent`
— schema changes are structural and can silently break callers built
against the old schema, so there's no "maybe it's just noise" case the way
there is for behavioral drift.

### Output-shape drift (the P0-level behavioral signal)

`computeOutputSignature(output)` builds a structural signature: keys,
nesting, and primitive types, **never values** (arrays are sampled — the
first 3 elements' shapes plus a length bucketed to `"N"` above that
threshold — so large arrays of uniform items produce a stable, compact
signature). `detectOutputShapeDrift` compares the *dominant* (most common)
signature in an earlier "baseline" window of executions to the dominant
signature in a more recent window, and only reports drift if:

- both windows have at least `minSampleSize` (default 5) successful, signed
  executions, and
- the new shape accounts for at least `minDominance` (default 0.6, i.e. 60%)
  of the recent window — a single one-off response shouldn't trigger an
  alert.

Severity scales with how dominant the new shape is: `high` at ≥90% of
recent calls, `medium` at ≥75%, `low` otherwise.

**What this deliberately does not do yet:** statistical comparison of
output *values* or latency *distributions* (e.g. a change-point test, a KS
test) — the spec calls this out explicitly as a P1 feature
("Behavioral drift detection: Statistical comparison of tool outputs over
time"). The P0 output-shape detector catches "a field was renamed/removed/
retyped" reliably; it will not catch "the numbers coming back are
statistically different but the same shape" — that's the P1 upgrade. See
[`decisions/0007-drift-detection-v0-scope.md`](./decisions/0007-drift-detection-v0-scope.md).
