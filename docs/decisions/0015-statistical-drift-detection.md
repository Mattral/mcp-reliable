# 0015 — Statistical drift detection, and two bugs found building it

## Status

Accepted.

## Context

[`decisions/0007-drift-detection-v0-scope.md`](./0007-drift-detection-v0-scope.md)
deliberately shipped only structural drift detection (schema, output
shape) for v1.0.0, scoping "statistical comparison of tool outputs over
time" — the spec's own P1 line item — to a later pass, and named the
extension point explicitly: "a third `DriftEvent.kind`, e.g.
`'statistical'`." This ADR covers that pass.

Before writing any new detector, every existing call site of the two
structural detectors was traced, to understand exactly where a new one
should plug in. That produced two findings that changed the scope of this
work.

## Finding 1: `detectOutputShapeDrift` was never actually invoked

`packages/core/src/drift.ts` exports `detectOutputShapeDrift`, and
`packages/core/test/drift.test.ts` thoroughly unit-tests it against
synthetic data. `docs/roadmap.md` lists it as "✅ ... both tested against
a real server across two sessions." None of that was wrong on its own —
but grepping every package for actual call sites turned up exactly one:
its own test file. `packages/collector/src/proxy-collector.ts`, the only
place that ever sees real tool-call output, only ever called
`detectSchemaDrift`. `packages/collector/src/health-checker.ts` couldn't
call it even if it tried — health checks only ever send `tools/list`,
never `tools/call`, so there's no tool output to compare there at all.

In other words: fully implemented, fully unit-tested, and dead in the
actual running system. The roadmap's "tested against a real server" claim
turns out to describe manual testing that happened once during
development, not anything the automated suite or the shipped code path
actually exercises.

**Decision:** fix this as part of the same pass, not file it as a
separate ticket. Building a second window-based detector on top of a
foundation where the first one isn't wired in would just compound the
gap, and the fix (wiring both into the same throttled check in
`proxy-collector.ts`) is naturally one piece of work.

## Finding 2: output signatures were computed over the wrong data

Wiring `detectOutputShapeDrift` in for real (rather than against the
synthetic `Execution` fixtures its unit tests use) surfaced a second,
deeper bug. `recordCallExecution` computed
`computeOutputSignature(message.result.content ?? message.result)` —
hashing MCP's transport-level `content` array directly.

For the extremely common case of a tool returning structured data as
JSON-serialized text (`content: [{ type: "text", text: "{...}" }]` —
exactly what this project's own reference server does, and what most
tools without a declared `outputSchema` do), that outer shape is
`[{type, text}]` *regardless of what's inside the string*. A live
end-to-end test — two 20-call windows, one against `echo`'s v1 output
shape and one against `MCP_RELIABLE_DEMO_MODE=v2`'s different shape —
caught this directly: both windows' "dominant signature" came back
byte-identical, because the hash never looked past the envelope.

This bug predates this pass; it's been there since output-shape drift was
first built, just never noticed because nothing ever ran it against real
tool output before now.

**Fix:** `packages/collector/src/output-payload.ts`'s
`extractOutputPayload`, called before signing instead of the raw result:

1. `structuredContent`, if the tool declared an output schema and the SDK
   populated it — already real, nothing to unwrap.
2. A single text content block that parses as JSON — the common
   "structured data serialized as text" convention.
3. Otherwise, the raw `content` array as-is — still catches a tool
   switching between text/image/resource blocks.
4. The raw result object, if there's no `content`/`structuredContent` at
   all (matches the old behavior for whatever didn't fit the above).

Unit tested directly (`packages/collector/test/output-payload.test.ts`),
including a test that reproduces the exact bug — two results with
identical outer shape but different embedded JSON — and asserts they now
extract to different, distinguishable payloads.

## The new detector: latency distribution drift

`detectLatencyDrift` (`packages/core/src/drift.ts`) compares successful
calls' `durationMs` between a baseline and a recent window via a
two-sample Kolmogorov-Smirnov test. Full parameter reasoning is in the
function's own docstring and `data-model.md#drift-detection`; the
short version: KS over a t-test because latency is typically
right-skewed, `minSampleSize=20` (vs. output-shape's 5) because a
distributional test needs more data to mean anything, `alpha=0.01` (vs.
the conventional 0.05) because this check runs repeatedly as traffic
accumulates rather than once, and a `minRelativeShift=0.2` floor because
statistical significance alone isn't sufficient justification for an
alert once sample sizes get large enough that any real difference reads
as "significant."

**The KS test's p-value approximation was verified, not just derived.**
`kolmogorovSmirnovTest` uses the classical asymptotic Kolmogorov
approximation (Stephens 1970's small-sample correction), not the more
refined finite-sample distribution recent scipy versions use internally
(a Marsaglia-Tsang-Wang recursion) — implementing that exactly would mean
shipping a small numerics library for a p-value that's only ever used as
an internal alert threshold. Before trusting the simpler formula, it was
checked against `scipy.stats.ks_2samp`:

- The D statistic (the actual test statistic — no approximation involved)
  matched exactly across every hand-picked and randomized test case run.
- Across 2,000 randomized trials (varying sample sizes 15–60, varying
  spread, varying whether a shift was present) at the intended operational
  `alpha=0.01`, the significance *decision* agreed with scipy's more
  refined implementation 99.65% of the time. Every disagreement fell
  within 0.005 of the alpha boundary — genuinely marginal cases, not
  systematic bias in one direction.

Good enough for an operational threshold; not represented anywhere as a
citable p-value.

### Where it runs, and the throttling decision

Both `detectOutputShapeDrift` and `detectLatencyDrift` are window-based —
they need whole batches of stored executions, not one fingerprint compare
like schema drift. Running that on every single tool call would mean a
store query plus a KS test per call on a proxy's hot path.
`StdioProxyCollector` now tracks a per-tool call count and only runs the
window check every `driftCheckIntervalCalls` calls (default 10), pulling
the last `driftWindowSize * 2` (default 20, matching `detectLatencyDrift`'s
own `minSampleSize`) executions and splitting them into recent/baseline
halves. Both new options default to values chosen for reasonably prompt
detection without meaningful per-call overhead; both are configurable per
collector instance if a specific deployment needs different tuning.

## Scoping decision: output *value* drift stays out of this pass

ADR 0007's P1 scope was two things: "statistical comparison of output
*values*" and "latency *distributions*." This pass only ships the second.

Output value drift — e.g. "the numbers in a response field used to
average 40, now average 400" — would require extracting and storing
actual numeric values from tool outputs, keyed by field path, for later
distributional comparison. That's not a pure engineering decision the way
latency drift was: today, nothing about tool output *content* is
persisted anywhere in this system, only shape and byte size
(`outputSignature`, `outputBytes`). Starting to store real extracted
values — even numbers, even shallow ones — is a data-retention decision
with real privacy surface (a tool could easily return something sensitive
in a field mcp-reliable would otherwise be sampling and keeping around
indefinitely) that nothing in this codebase's history has made before.

Deferred rather than silently bundled in with a guessed-at scope (which
fields, what depth, what retention). Worth a direct product conversation
before writing code, the same way token-usage tracking's tokenizer choice
was flagged as needing one.

## Consequences

- `DriftEvent.kind` gains `"statistical"`; a new optional `metric` field
  (currently only `"latency"`) distinguishes which statistic, since
  unlike `"schema"`/`"output-shape"`, `"statistical"` alone isn't
  self-describing.
- `drift_events` gained a `metric` column — this project's actual first
  schema migration (`SCHEMA_VERSION` 1 → 2). Migration tested against a
  real pre-migration database file (not just the in-memory happy path):
  built by hand with the old schema, a pre-existing row inserted,
  `user_version` left at 1, then opened through `SqliteStore` and
  verified the column was added, the old row survived with `metric`
  correctly `undefined` (not a stringified `"null"`), and new writes with
  `metric` set work — then re-opened as a completely fresh raw connection
  to confirm the migration actually persisted to disk.
- The dashboard's independently-maintained `DriftEvent`/`DriftKind` types
  (see ADR 0008 on that duplication) were updated to match.
- `examples/reference-mcp-server` gained a `MCP_RELIABLE_ARTIFICIAL_DELAY_MS`
  env var (default 0, no behavior change) so `echo`'s latency can be
  controlled on demand for verification — needed because `flaky`'s
  latency is randomized, not reproducible enough to demonstrate a specific
  before/after shift.
- `docs/roadmap.md`'s "Basic drift detection... ✅" line was corrected —
  see that file for current status of all three detectors.
