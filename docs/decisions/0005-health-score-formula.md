# 0005 — Health score formula

## Status

Accepted (revised once during initial development — see "Revision" below).

## Context

The spec asks for a way to know "if a tool is getting worse over time" and
to power alerting on "health degradation." That needs a single composite
number derived from two things that matter for different reasons:
**reliability** (does it work?) and **latency** (is it fast enough to be
useful to an agent?) — plus, secondarily, whether anything has structurally
or behaviorally drifted recently.

## Decision

```
successRate   = successCount / sampleCount
latencyScore  = clamp01(1 - (p95Ms - goodMs) / (badMs - goodMs))   // defaults: goodMs=500, badMs=5000
weightedBlend = successWeight + latencyWeight * latencyScore        // defaults: successWeight=0.65, latencyWeight=0.35
base          = 100 * successRate * weightedBlend
score         = clamp(base - min(sum(driftPenalty[severity]), maxDriftPenalty), 0, 100)
```

Default drift penalties: 3 (low) / 8 (medium) / 15 (high) points per
unresolved event, capped at 30 points total regardless of event count — so
a tool that's otherwise perfectly reliable can't be driven to zero by drift
alone, but a genuinely degraded *and* drifting tool is scored worse than
either problem in isolation.

All of these are exposed as overridable `HealthScoreWeights` rather than
hard-coded, since the "right" latency thresholds obviously differ by tool
(matching a database query's expected latency against a web-search tool's
would be wrong in both directions) — see
`packages/core/src/health-score.ts`'s `ComputeHealthScoreOptions.weights`.

## Rationale for multiplicative gating (the important part)

`successRate` is not just one weighted term among others — it
**multiplicatively gates** `weightedBlend`, which itself never exceeds 1.
This means:

- `successRate = 0` → `score = 0`, always, regardless of latency.
- `successRate = 1` → `score` ranges from `successWeight * 100` (worst
  latency) to `100` (best latency).
- Any intermediate `successRate` scales that same range down proportionally.

The alternative — a simple weighted average,
`100 * (successWeight * successRate + latencyWeight * latencyScore)` — was
the *first* implementation, and it shipped with a passing test suite. It
was wrong.

## Revision

During development, a test asserting "a completely failing server scores
0" failed against the additive formula: 20 executions, every one a fast
(10ms) failure, scored **35** — because `100 * (0.65 * 0 + 0.35 * 1)` gives
full credit for the latency term even at 0% success. The formula was
technically doing exactly what it was written to do; what it was written
to do was wrong. A tool that fails literally every call is not "35% as
healthy as a perfect one" merely because the failures return quickly —
"fails instantly" is not a meaningfully healthier state than "fails
slowly" when nothing succeeds either way.

The fix (documented above and in `data-model.md#health-scoring`) makes
`successRate` a multiplicative gate instead. This changed one other test's
expected value along the way: a 50%-success, perfect-latency scenario
moved from an expected score of 67.5 (additive) to 50 (gated) — and 50 is
the more defensible number: half your calls fail, so your ceiling is half,
regardless of how fast the successful half is.

This is recorded here rather than just fixed silently because it's a good
example of why `core`'s algorithms are pure, independently unit-tested
functions (ADR 0001) — the bug was caught by a test *before* this reached a
released version, specifically because the health-scoring logic doesn't
require a database or a running server to exercise every edge case
directly.

## Consequences

- Any future change to these weights or thresholds should re-run
  `packages/core/test/health-score.test.ts` and think through the same
  boundary cases (0% success, 100% success at each latency extreme, mixed
  success rates) before merging — they're the cheapest possible check
  against this exact class of bug recurring.
- Operators tuning `latencyGoodMs`/`latencyBadMs` per tool should expect
  the *shape* of the curve (linear between good/bad, clamped at both ends)
  to stay simple by design — a v0 scorer favors "easy to reason about by
  hand" over a more sophisticated curve.
