# 0007 — Drift detection v0 scope: structural, not statistical

## Status

Accepted, scoped as a deliberate P0/P1 boundary.

## Context

The spec draws this exact line itself: P0 lists "Basic drift detection:
Schema + simple output signature changes," while P1 separately lists
"Behavioral drift detection: Statistical comparison of tool outputs over
time" as a distinct, later feature. This ADR records how that boundary was
actually implemented and why it was kept where the spec drew it rather than
pulled forward.

## Decision

Two detectors shipped for v0, both structural rather than statistical:

1. **Schema drift** (`detectSchemaDrift`): a straight equality check between
   two SHA-256 fingerprints of a canonicalized JSON schema. No sampling, no
   threshold — any change is reported, at `high` severity, because a schema
   change is a fact about the tool's contract, not an inference from noisy
   data.
2. **Output-shape drift** (`detectOutputShapeDrift`): compares the *most
   common* structural shape (keys/nesting/primitive types, never values) of
   outputs between an earlier and a later window of successful calls,
   requiring a minimum sample size and a dominance threshold in both
   windows before reporting anything (see `data-model.md#drift-detection`
   for the exact numbers and reasoning).

What was explicitly **not** built: statistical comparison of output
*values* (e.g., "the numbers in this field used to average 40 and now
average 400") or of *latency distributions* (e.g., a change-point or KS
test detecting a subtle but real shift that a fixed p95 threshold alone
wouldn't catch).

## Consequences

- The v0 detectors reliably catch "a field was renamed, removed, or
  changed type" (schema drift) and "the response's overall structure
  changed" (output-shape drift) — both genuinely useful and, done
  incrementally, unlikely to need much revision even once statistical
  detection is added alongside them.
- They will **not** catch a tool that keeps returning the same shape but
  with meaningfully different values (a search tool that starts returning
  empty result arrays with the same schema, for instance — same shape,
  degraded content) or a latency distribution that's shifted but still
  within the fixed p95 thresholds `computeHealthScore` uses. That gap is
  intentional and tracked as the P1 "behavioral drift detection" item in
  `roadmap.md`, not treated as an oversight in v0.
- When statistical detection is built, it should be additive (a third
  `DriftEvent.kind`, e.g. `"statistical"`) rather than a replacement for
  the two structural detectors — schema and shape changes are cheap,
  deterministic, zero-false-positive-by-construction signals that a
  statistical layer shouldn't need to subsume.
