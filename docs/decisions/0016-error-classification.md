# 0016 — Error classification, and a third instance of the same bug

## Status

Accepted.

## Context

`HANDOFF.md`'s remaining-work list described this as the smallest
remaining P1 item: "grouping/clustering `Execution.errorMessage` into
common failure modes." No detailed spec existed beyond that one line —
the original `mcp-reliable-project-spec.md` this project was built from
isn't preserved anywhere in the repo, just referenced narratively in
`HANDOFF.md`. The design below is this pass's own scoping, not a
pre-existing spec being implemented.

## Finding: tool-level error text was already being discarded

Before designing a classifier, the actual data it would classify was
checked. `Execution.errorMessage`, for a proxy-observed tool call, was
being set via:

```ts
errorMessage: isError ? message.error?.message ?? "Tool call returned isError: true" : undefined
```

`message.error` is only populated for **protocol-level** JSON-RPC errors
(malformed requests, transport failures). The MCP spec's convention for a
**tool** reporting its own failure is different: a normal `result` with
`isError: true`, and the actual description of what went wrong living in
`result.content` as ordinary text blocks — exactly what this project's
own reference server's `flaky` tool does
(`{ content: [{ type: "text", text: "simulated transient failure" }],
isError: true }`). Since `message.error` is `undefined` for that case,
every single tool-level failure's real error text was being thrown away
in favor of one identical placeholder string, verified live: 15 calls to
`flaky` (which fails ~25% of the time) produced 3 failures, all three
recorded as `"Tool call returned isError: true"` — none retaining
`"simulated transient failure"`.

This is architecturally the same mistake `extractOutputPayload` fixed in
[`decisions/0015-statistical-drift-detection.md`](./0015-statistical-drift-detection.md):
treating MCP's `content` array as opaque instead of reading what's
actually inside it. Same root cause, different field, found the same way
— by checking what a new feature's *input data* actually looks like
before building on top of it, rather than assuming existing plumbing was
already correct.

**Fix:** `packages/collector/src/error-message.ts`'s `extractErrorMessage`,
used in place of the old inline logic:

1. A protocol-level `error.message`, if present — unchanged from before.
2. Otherwise, the joined text of every `text`-type content block in a
   tool-level `isError: true` result.
3. A generic placeholder only if neither exists at all.

Unit tested directly, including the exact reproduction of the bug (a
tool-level error with real text, previously reduced to the placeholder).

## Design: classification

A fixed taxonomy (`packages/core/src/error-classification.ts`), checked
against free-text error messages via ordered regex rules, first match
wins: `rate-limit`, `auth`, `not-found`, `timeout`, `validation`,
`connection`, `server-error`, falling back to `unknown`.

**Why regex over something more sophisticated:** error messages here come
from arbitrary third-party MCP servers with no shared format to rely
on — unlike, say, classifying HTTP status codes in a single controlled
API. A learned classifier would need labeled training data this project
has no source for; a fixed taxonomy with simple pattern matching is easy
to audit, easy to extend by adding a pattern, and good enough to
distinguish "this tool needs backoff/retry" from "this tool needs a
different API key" from "this tool is genuinely down" — the operationally
relevant distinctions an agent or operator would act on differently.

**Known, accepted trade-offs of a pattern-based approach**, documented in
the module itself rather than glossed over: a message containing an
unrelated number that happens to match a status-code pattern (e.g. "processed
400 items" matching the `400` validation pattern) would misclassify; a
genuinely novel phrasing this doesn't recognize falls to `unknown` rather
than the "correct" category. Both are accepted for a heuristic whose job
is triaging which failure mode is worth investigating first, not
providing a certified diagnosis.

`summarizeErrorCategories(executions)` groups a set of executions' failures
by category, sorted by count descending, each with a real example message
so a human isn't left guessing what "auth" actually looked like in
practice. Ratios are computed against the count of classifiable failures,
not all executions, so they always sum to 1.

## Where this surfaces

- **CLI `mcp-reliable report`**: `buildServerReport` now computes
  `errorSummary` from the same `proxyExecutions` it already gathers for
  the health score (no extra query), printed as a new "Errors, by likely
  cause" section whenever there are any.
- **Agent interface**: `computeAgentHealthSummary` gained the same field,
  surfaced through the existing `get_server_health` tool — an agent
  deciding whether to keep using a degraded server now gets *why* it's
  degraded, not just a score.
- **Not done this pass, deliberately**: a dashboard visualization.
  `/api/servers/:id/health` (`packages/server/src/app.ts`) is the natural
  place to add `errorSummary`, mirroring exactly how the CLI and
  agent-interface consume it — but a dashboard component, its data
  fetching, and its own tests are a distinct, well-scoped enough chunk of
  work that bundling it into an already-large pass risked doing it
  hastily. Left as a clearly actionable next step rather than half-built.
- **Not touched**: `buildRecommendation` (`packages/core/src/recommendations.ts`).
  It has a carefully-documented, already-tested priority-order contract
  for its verdict and reason string; folding error-category context into
  it is a real design question (how does "mostly rate-limited" interact
  with the existing reachable/health-score/drift priority ladder?) worth
  its own consideration rather than a bolt-on. An agent can already get
  both the verdict (`get_recommendation`) and the why
  (`get_server_health`'s `errorSummary`) today.

## Consequences

- `Execution.errorMessage` for proxy-observed tool-level failures is now
  meaningfully descriptive going forward; historical rows recorded before
  this fix still say the old generic placeholder (nothing retroactively
  reclassifies stored data — this is a fix to collection, not a backfill).
- No schema or storage changes — classification is computed on demand
  from the existing `errorMessage` string, not persisted as a new column,
  so the taxonomy itself can evolve (new patterns, new categories) without
  needing another migration.
