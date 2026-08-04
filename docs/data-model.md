# Data Model

All types below are defined with `zod` schemas in `packages/core/src/types.ts`
(so they're both a compile-time type and a runtime-validatable schema) and
persisted by `@mattral/storage` in the SQLite tables shown.

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
| `errorMessage` | string? | For proxy-observed tool-level failures, extracted from the actual error text in `result.content`, not just a generic placeholder — see "Error classification" below. |
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

A notification-worthy event. All three `kind`s are active:

- `unreachable` — `monitor`'s `reconcileUnreachableAlert`: opens a
  `critical` alert on the first unreachable check, resolves it once the
  server recovers, never duplicates while already open.
- `health-degradation` — `monitor`'s `reconcileHealthDegradationAlert`,
  backed by `core`'s `detectHealthDegradation`: opens/resolves on
  *transitions* between health-score bands (healthy/warning/critical), not
  on every tick a server happens to still be degraded. See
  `decisions/0010-alerting-notifier-design.md`.
- `drift` — `monitor`'s `recordDriftAlerts` (schema drift found during a
  health check) and `proxy`'s `onDrift` handler (drift found in live
  traffic). No "resolved" state — a drift alert is a point-in-time fact,
  like the `DriftEvent` log itself, not an ongoing condition.

Delivery beyond the local database and the CLI's own terminal output is
`@mattral/notifier`'s job — see `architecture.md#alerting`. The REST
API (`/api/servers/:id/alerts`) and the dashboard's drift/alerts panel
both just read whatever's been recorded; alerting configuration
(`--webhook`/`--slack-webhook`) is CLI-only today.

### Recommendation (not persisted)

`{ level: "avoid" | "caution" | "healthy" | "unknown", reason: string }` —
computed on demand by `core`'s `buildRecommendation`, never stored. Unlike
every entity above, a recommendation isn't a fact about the past; it's a
verdict about *right now*, synthesized fresh from a server's current
reachability, health score, and recent drift every time it's asked for.
Exposed via `@mattral/agent-interface`'s `get_recommendation` and
`list_recommendations` tools — see
`architecture.md#agent-interface` and
`decisions/0011-agent-interface-design.md`.

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

Three independent detectors, all pure functions in
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

**What `computeOutputSignature` is actually called on matters.** A raw MCP
`tools/call` result's `content` array is `[{ type: "text", text: "..." }]`
for the extremely common case of a tool returning JSON-serialized
structured data as a text block — that outer shape never changes even when
the *real* payload embedded in `text` does, so hashing `result.content`
directly is close to useless. `@mattral/collector`'s
`extractOutputPayload` (in `packages/collector/src/output-payload.ts`)
unwraps this before signing: it prefers `structuredContent` when a tool
declares an output schema, otherwise parses a single JSON text block into
its real shape, and only falls back to hashing the content array itself
for genuinely unstructured or multi-block results. This was a real,
previously-shipped bug — see
[`decisions/0015-statistical-drift-detection.md`](./decisions/0015-statistical-drift-detection.md)
for how it was found.

### Statistical drift (the P1 upgrade — currently latency only)

`detectLatencyDrift` compares the *distribution* of successful calls'
`durationMs` between an earlier baseline window and a more recent one,
using a two-sample Kolmogorov-Smirnov test (`kolmogorovSmirnovTest` in
`packages/core/src/stats.ts`) — chosen over a t-test because latency
distributions are typically right-skewed, not normal. It reports drift
(`kind: "statistical"`, `metric: "latency"`) only when:

- both windows have at least `minSampleSize` (default 20 — notably higher
  than output-shape drift's 5, since a KS test needs more data to have
  real power) successful executions,
- the KS test is significant at `alpha` (default 0.01, deliberately
  stricter than the conventional 0.05 — this check runs repeatedly as
  traffic accumulates, not once), **and**
- the shift in median latency is at least `minRelativeShift` (default
  0.2, i.e. 20%) — statistical significance alone isn't sufficient
  justification for an alert once sample sizes get large; a tiny,
  operationally meaningless shift can still be "significant."

This catches what the P0 output-shape detector and `computeHealthScore`'s
fixed p95 threshold both miss: a tool that's gotten durably slower (or
faster) but hasn't crossed a fixed threshold, or where the *shape* of the
latency distribution changed (e.g. a new bimodal pattern) without moving
the mean much. See
[`decisions/0015-statistical-drift-detection.md`](./decisions/0015-statistical-drift-detection.md)
for the KS-test approximation's verification methodology.

**What this still deliberately does not do:** statistical comparison of
output *values* (e.g. "the numbers in this field used to average 40, now
average 400") — the other half of the P1 spec item ("Behavioral drift
detection: Statistical comparison of tool outputs over time"). Unlike
latency, this would require storing actual numeric values extracted from
tool outputs — a real data-retention decision nothing in this project has
made before (today literally nothing about output *content* is
persisted, only shape/size) — so it's deliberately scoped out rather than
silently bundled in. See
[`decisions/0007-drift-detection-v0-scope.md`](./decisions/0007-drift-detection-v0-scope.md)
and [`decisions/0015-statistical-drift-detection.md`](./decisions/0015-statistical-drift-detection.md).

### Where these actually run

Schema drift is checked from both `mcp-reliable monitor`'s health checks
(`tools/list` only) and `mcp-reliable proxy`'s live traffic (also
`tools/list`, whenever the proxied client asks for it) — it's an O(1)
fingerprint compare, cheap enough to run on every observation.
Output-shape and statistical drift need whole *windows* of executions
with real tool outputs, which only the proxy's live `tools/call` traffic
produces; `StdioProxyCollector` checks both every `driftCheckIntervalCalls`
calls (default 10) per tool, throttled so a window-comparison query and a
KS test don't run on literally every single call.

## Error classification

`classifyError(errorMessage)` (`packages/core/src/error-classification.ts`)
sorts a raw error message string into one of a fixed set of common failure
modes — `rate-limit`, `auth`, `not-found`, `timeout`, `validation`,
`connection`, `server-error`, or `unknown` — via ordered regex pattern
matching, first match wins. This is deliberately simple pattern matching,
not a learned classifier: error messages come from arbitrary third-party
MCP servers with no shared format, so a fixed, auditable taxonomy that's
easy to extend by adding a pattern is a better fit than something that'd
need labeled training data this project has no source for. See
[`decisions/0016-error-classification.md`](./decisions/0016-error-classification.md)
for the known trade-offs of that approach (occasional misclassification
from an unrelated number matching a status-code-shaped pattern, novel
phrasings falling to `unknown`) — accepted for a heuristic whose job is
triaging what's worth investigating first, not certifying a diagnosis.

`summarizeErrorCategories(executions)` groups a set of executions'
failures by category, sorted by count descending, each with a real
example message. This depends on `errorMessage` actually containing the
tool's real error text — for proxy-observed tool-level failures (`result:
{isError: true, content: [...]}`), that required a fix of its own:
`@mattral/collector`'s `extractErrorMessage`
(`packages/collector/src/error-message.ts`) now reads the actual text out
of `content` instead of discarding it for a generic placeholder, the same
underlying mistake `extractOutputPayload` fixed for output-shape drift
(see `decisions/0016-error-classification.md` for how this was found).

Surfaced today via `mcp-reliable report` (an "Errors, by likely cause"
section) and the agent interface's `get_server_health` tool
(`errorSummary`). Not yet surfaced in the dashboard — a deliberate scope
boundary for this pass, not an oversight; see the ADR.
