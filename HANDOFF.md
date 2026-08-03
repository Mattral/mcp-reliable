# mcp-reliable — Project Handoff

**Read this whole document before touching code.** It exists so a new
conversation — with zero memory of how this project was actually built —
can pick up exactly where it left off, make decisions consistent with
everything already decided, and keep the documentation habits that got
this project to a real, published v1.0.0 intact.

If you're a future Claude instance reading this cold: the person you're
talking to is **Min Htet Myet (Mattral)** — GitHub `Mattral`, npm
`~mattral`. They value direct, unvarnished engineering feedback over
flattery, are building toward frontier-AI-lab-standard portfolio work, and
have a strong, consistently demonstrated preference for **things being
actually verified, not just plausible** — every non-trivial claim in this
project's own history was checked by running the real thing, not just
reasoning about it. Match that standard. Don't say something works until
you've run it.

---

## 1. What this project is

`mcp-reliable` is a runtime observability and reliability platform for the
Model Context Protocol ecosystem. Where `mcp-observatory` audits MCP
servers before deployment and `inspector` helps debug one by hand,
`mcp-reliable` watches servers *while they're running*: is this server up
right now, is a tool getting less reliable over time, and did its schema
or output shape change out from under the agents calling it.

It started from a single ambitious spec document
(`mcp-reliable-project-spec.md`) that split scope into three tiers:

- **P0 — Foundation (MVP).** Health monitoring, per-tool metrics, basic
  drift detection, a CLI, local-first storage, stdio+SSE support, a basic
  dashboard.
- **P1 — Production Readiness.** Statistical drift detection, token
  tracking, error classification, a multi-server fleet view, webhook/Slack
  alerting, a full agent-facing MCP interface, historical trends.
- **P2 — Advanced Capabilities.** Cost optimization, a custom rule engine,
  OpenTelemetry export, ML-based anomaly detection, team features/RBAC.

**Status as of this handoff: v1.0.0 is built, tested, and live on npm.**
P0 is essentially complete (one partial item). 4 of 7 P1 items are done.
P2 hasn't been started — and per the spec's own framing, that's fine; P2
was never meant to gate a release.

## 2. Where it actually lives right now

- **GitHub:** `https://github.com/Mattral/mcp-reliable`
- **npm, unscoped CLI:** [`mcp-reliable`](https://www.npmjs.com/package/mcp-reliable)
  — install with `npm install -g mcp-reliable`
- **npm, scoped libraries:** everything else publishes under
  [`@mattral`](https://www.npmjs.com/~mattral) — `@mattral/core`,
  `@mattral/storage`, `@mattral/collector`, `@mattral/notifier`,
  `@mattral/agent-interface`, `@mattral/server`. (Originally planned as a
  dedicated `@mcp-reliable` npm org — that name was already taken when
  actually creating it, so it moved to the maintainer's personal scope
  instead. See ADR 0013.)
- **Not published:** `@mattral/dashboard` and
  `@mattral/reference-mcp-server` are both `"private": true` — the
  dashboard ships *bundled inside* `@mattral/server`'s tarball instead of
  as its own package (see §12, ADR 0012), and the reference server is a
  test fixture / demo target only.
- **Version:** everything moved to `1.0.0` in lockstep for this release
  (not independently versioned per package — see ADR 0012 for why, and
  what would trigger switching to independent versioning later).

## 3. Philosophy — read this before making design calls

A few things have held constant across every feature added to this
project, stated explicitly so a new contributor doesn't have to
reverse-engineer them from the diff:

**Verify by actually running it, not by reasoning about it.** This
project's own history contains at least six real bugs that automated
tests did *not* catch, each found only by spinning the thing up for real
and driving it like an actual user would:

1. A health-score formula giving a 100%-failing server partial credit for
   failing fast (ADR 0005) — caught by a unit test, but only because the
   test bothered to assert the *boundary* case, not just typical inputs.
2. A CI failure on Node 20 because the reference MCP server was spawned
   from unbuilt `.ts` source — Node's built-in TypeScript stripping is
   22.6+ only, and this project targets Node 20+ (ADR 0009). Only showed
   up on the CI matrix's *other* Node version.
3. A webhook notification that could be lost if the `proxy` process
   exited before an in-flight `fetch()` completed (ADR 0010) — found by
   standing up a real mock HTTP receiver and killing a real spawned
   process at the exact wrong moment.
4. The agent interface's database connection closing before any tool call
   could execute, because `server.connect(transport)` resolves on
   handshake, not session end (ADR 0011) — invisible to the
   `InMemoryTransport`-based unit tests, which never touch that lifecycle
   at all; only caught by spawning `mcp-reliable mcp` as a real process
   and driving it with a real client.
5. A standalone `npm install @mattral/server` (outside the monorepo)
   silently never finding the dashboard, since npm doesn't preserve
   monorepo sibling directories (ADR 0012) — found by literally hiding the
   sibling directory to simulate the real installed shape.
6. The `@mcp-reliable` npm org name being unavailable (ADR 0013) — you
   cannot check org-name availability from outside npm's own UI; this was
   only discoverable by actually trying to create it.

**The lesson, stated as a standing practice:** whenever you add a new
package, a new CLI command, or anything that gets spawned/installed/run
as a real standalone artifact, verify it in that exact shape before
calling it done — not just via the fast unit-test suite. The fast suite
(225 tests, described in §6) is genuinely valuable and should stay
fast and mock-free where it can, but it is not a substitute for "did I
actually run this the way a real user would."

**Own mistakes in writing, not just in code.** Every ADR that documents a
bug documents it *as* a bug — what was believed, what turned out to be
wrong, and why the fix is correct — rather than quietly fixing it and
moving on. This is a deliberate practice, not incidental. Keep it up:
future contributors (human or AI) benefit far more from "here's a wrong
turn and how we knew it was wrong" than from a changelog that reads as if
everything was correct on the first try.

**Prefer small, deliberate duplication over premature abstraction — but
apply the "rule of three."** ADR 0006 explicitly accepted ~15 lines of
duplicated config-resolution logic between the CLI and server packages
rather than inventing a shared package for two consumers. ADR 0008
extended this to the dashboard's browser-safe type/threshold duplication.
But when a *third* consumer needed the same logic (the agent interface
needing the same secret-redaction logic the REST API already had), that
was the actual trigger to extract it into `core` — not before, not
indefinitely deferred either. Use this same threshold going forward: two
duplicated call sites, leave it; three, extract it.

**Every non-obvious decision gets an ADR.** Thirteen exist
(`docs/decisions/0001` through `0013`). They are not a bureaucratic
formality — they're what makes it possible to onboard cold. If you make a
decision a future reader would otherwise have to reverse-engineer from a
diff, write it down the same way.

**Documentation is not an afterthought bolted on at the end — it's part
of the same commit as the feature.** Every feature pass in this project's
history updated `docs/roadmap.md`'s status table, added or updated the
relevant `docs/*.md` file, and updated `CHANGELOG.md` in the same body of
work as the code change, not as a separate cleanup pass later. Keep doing
this. See §7 for the exact mechanics.

## 4. Architecture

### 4.1 Package map and dependency graph

```
@mattral/core         — pure data model, health scoring, drift detection,
                         alerting logic, recommendation synthesis,
                         transport-secret redaction. Zero I/O except zod
                         and node:crypto (SHA-256 hashing, UUIDs) — no
                         filesystem, no network, no database. This is
                         deliberate: every algorithm in core is a pure
                         function over plain data, testable without
                         spinning up anything.
                         ↓
@mattral/storage       — SQLite persistence (better-sqlite3) behind a
                         storage-agnostic `ReliabilityStore` interface.
                         `SqliteStore` is the only implementation today;
                         a future Postgres-backed implementation of the
                         same interface is a real, designed-for option
                         (ADR 0002), not a hypothetical.
                         ↓
@mattral/collector     — HealthChecker (pull-based: connect, list tools,
                         disconnect — NEVER calls a tool, a deliberate
                         safety boundary) + StdioProxyCollector (a
                         transparent traffic-observing proxy: spawns the
                         real server as a child process, forwards every
                         JSON-RPC message verbatim, records real tool
                         calls as they pass through). stdio only; SSE/HTTP
                         proxying is a different, harder problem, not
                         built (see §9).
                         ↓ (branches three ways from here)
@mattral/notifier      — WebhookNotifier + SlackNotifier + CompositeNotifier
                         behind a single Notifier interface, for alert delivery.
@mattral/agent-interface — Agent-facing MCP tools exposing mcp-reliable's
                         own data: list_servers, get_server_health,
                         list_drift_events, list_alerts, get_recommendation,
                         list_recommendations. stdio only, run via
                         `mcp-reliable mcp`.
@mattral/server        — REST API (Hono) over the same data, plus serves
                         the built dashboard as static assets.
                         ↓
mcp-reliable (the CLI) — depends on core, storage, collector, notifier,
                         and agent-interface. Published UNSCOPED (not
                         @mattral/cli) specifically so `npm install -g
                         mcp-reliable` / `npx mcp-reliable` match the
                         product's own name (ADR 0012).

@mattral/dashboard (private, not published) — React 19 + Tailwind v4 +
                         Vite web dashboard. Depends on NOTHING internal —
                         deliberately duplicates a handful of types and
                         color thresholds from `core` rather than
                         importing it, because `core`'s `fingerprint.ts`
                         imports `node:crypto`, which doesn't exist in a
                         browser bundle (ADR 0008). Its built output gets
                         bundled INTO @mattral/server's published tarball
                         via a prepublishOnly script (ADR 0012) — a
                         standalone `npm install @mattral/server` outside
                         this monorepo would otherwise never find it,
                         since npm doesn't preserve monorepo sibling
                         directories.

examples/reference-mcp-server (private, not published) — a 3-tool
                         (echo, add, flaky) stdio MCP server used by
                         collector integration tests and the
                         getting-started guide. Has a built-in
                         MCP_RELIABLE_DEMO_MODE=v2 switch that changes a
                         tool's output shape and another's input schema,
                         for demonstrating live drift detection on demand.
```

**No cycles.** Every arrow points one direction. If you're about to add an
import that would create one, that's a signal the responsibility is drawn
in the wrong place — see ADR 0001 for the reasoning behind where every
current boundary sits.

### 4.2 The three ways mcp-reliable observes a server (ADR 0003)

The original spec posed an open question: pull-based collection (health
checks) or push-based (the server instruments itself)? This project
resolved it with a third option that gets most of the benefit of both
without requiring the monitored server to change at all:

1. **Pull (`HealthChecker`)** — connects as a real MCP client, completes
   `initialize`, calls `tools/list`, disconnects. Never calls a tool. This
   is what `mcp-reliable monitor` uses.
2. **Traffic-observing proxy (`StdioProxyCollector`)** — the interesting
   one. `mcp-reliable proxy <id> -- <real command>` spawns the real
   server as a child process and becomes a byte-for-byte transparent
   pass-through between it and whatever real client launches this
   command, recording every `tools/call` and `tools/list` message as it
   flows through. The integration point is a one-line change to the
   *client's* launch config — the server's source is never touched. This
   is how real, live traffic gets observed without instrumentation.
3. **(Not built) true in-process push** — a server author importing an
   SDK and reporting telemetry directly. Explicitly left as a future
   option, not needed for the value this project already delivers.

### 4.3 Data model (all defined in `packages/core/src/types.ts` as zod
schemas — both a runtime-validatable schema and a compile-time type)

| Entity | Key fields | Notes |
|---|---|---|
| `Server` | id, name, transport (stdio/sse/http discriminated union), tags, createdAt, healthCheckIntervalMs | `healthCheckIntervalMs` is stored but not yet *enforced* per-server by `monitor` (known limitation, see §9) |
| `Tool` | id, serverId, name, schemaFingerprint, inputSchema, firstSeenAt, lastSeenAt | fingerprint = SHA-256 of canonicalized (key-sorted) JSON schema |
| `Execution` | id, serverId, toolName, startedAt, durationMs, success, errorMessage, outputSignature, inputBytes/outputBytes, source (`"proxy"` \| `"health-check"`) | `inputBytes`/`outputBytes` are byte-size proxies, explicitly NOT token counts — see §9 |
| `HealthScore` | serverId, windowStart/End, score (0-100), successRate, p50/p95LatencyMs, errorRate, sampleCount | persisted snapshot, not derived on every read |
| `DriftEvent` | id, serverId, toolName, detectedAt, kind (`"schema"` \| `"output-shape"`), severity (low/medium/high), description, previousValue/newValue | |
| `Alert` | id, serverId, triggeredAt, severity (info/warning/critical), kind (`"health-degradation"` \| `"drift"` \| `"unreachable"`), message, resolvedAt | all three kinds are actively produced as of v1.0.0 |
| `Recommendation` (NOT persisted) | level (avoid/caution/healthy/unknown), reason | computed fresh on every query, never stored — see §4.5 |

### 4.4 The health score formula — get this exactly right if you touch it

```
successRate   = successCount / sampleCount
latencyScore  = clamp01(1 - (p95Ms - goodMs) / (badMs - goodMs))   // 1.0 at/below 500ms, 0.0 at/above 5000ms by default
weightedBlend = successWeight + latencyWeight * latencyScore        // 0.65 / 0.35 by default
base          = 100 * successRate * weightedBlend
score         = clamp(base - min(sum(driftPenalty per severity), maxDriftPenalty), 0, 100)
```

**The critical detail:** `successRate` is a *multiplicative gate*, not one
term in a weighted average. A server failing 100% of calls scores exactly
0, no matter how fast the failures return. The first implementation of
this formula used a simple weighted average instead
(`100 * (successWeight*successRate + latencyWeight*latencyScore)`), and it
gave a 100%-failing-but-fast server a score of **35** — a real bug, caught
by a test asserting the boundary case, documented in full in ADR 0005. If
you ever touch this formula, re-run
`packages/core/test/health-score.test.ts` and think through the same
boundary cases (0% success, 100% success at each latency extreme, mixed
rates) before merging.

### 4.5 Drift detection — two detectors, deliberately not statistical yet

- **Schema drift**: straight SHA-256 equality check between two
  fingerprints of a canonicalized JSON schema. Any change is `high`
  severity, no sampling — a schema change is a structural fact, not a
  statistical inference.
- **Output-shape drift**: compares the *dominant* (most common) structural
  signature (keys/nesting/primitive types — never values) between an
  earlier baseline window and a recent window, requiring a minimum sample
  size (5) and dominance threshold (60%) in both before reporting
  anything.
- **What's deliberately NOT built** (ADR 0007, and P1 in the roadmap):
  statistical comparison of output *values* or latency *distributions* —
  today's detectors catch "a field was renamed/retyped," not "the numbers
  coming back are statistically different but the same shape."

### 4.6 Recommendation synthesis (`core`'s `buildRecommendation`)

Priority order, each strictly outranking the ones below it:
1. `avoid` — currently unreachable (nothing else matters if it's down)
2. `avoid` — critical health score (real traffic mostly failing)
3. `caution` — degraded (but not critical) health score
4. `caution` — recent high-severity drift, otherwise healthy
5. `unknown` — no data of either kind yet (deliberately distinct from
   `healthy` — "no signal" and "good signal" are different states)
6. `healthy` — none of the above

This exists specifically for the agent-facing MCP interface's
`get_recommendation`/`list_recommendations` tools — "should I use this
tool right now" as a single call, not raw numbers an agent has to
interpret itself.

## 5. Design patterns and coding standards actually in force

- **TypeScript, strict mode, ESM (`NodeNext` module resolution)
  throughout.** Every relative import uses an explicit `.js` extension
  even though the source is `.ts` (NodeNext requires this).
- **Zod for runtime-validated boundaries** (the data model in `core`,
  every CLI-adjacent input schema in the agent interface's tools).
- **Pure functions extracted and exported wherever the logic is
  meaningful**, even from CLI command files that look like simple
  wiring — e.g. `reconcileUnreachableAlert`, `buildServerReport`,
  `resolveTransport` are all exported from their command modules
  specifically so they're unit-testable without spawning a CLI process.
  The *pattern*: command files should be thin orchestration over
  independently-testable functions, not places where real logic hides
  untested.
- **Every package that spawns or is spawned as a real process gets tested
  against the real thing**, not a mock of the protocol — collector tests
  spawn the actual reference server; agent-interface tests drive a real
  MCP `Client` over the SDK's own `InMemoryTransport`; server tests use
  Hono's real `app.request()`. The one exception is `notifier`, which
  injects a fake `fetch` — appropriate there, since the point is testing
  payload shape and error handling, not real HTTP.
- **ESLint flat config** (`eslint.config.js`) + Prettier, no separate
  per-package config. Plain `.mjs` scripts (e.g.
  `packages/server/scripts/copy-dashboard.mjs`) get their own Node
  globals block since TypeScript files get ambient Node types for free
  but plain JS files don't.
- **`npm run build` (via `tsc -b` project references) produces real
  `dist/` output that everything actually runs from** — nothing in the
  shipped CLI or server runs from `src/` directly. The *one* narrow,
  documented exception is the reference server, which can still be run
  directly via `node src/index.ts` on Node 22.6+ (its syntax is kept free
  of constructor parameter properties/enums/namespaces specifically to
  allow this), but nothing in the project's own tooling relies on that
  anymore after ADR 0009.
- **`vitest.config.ts` aliases every workspace package name to its
  `src/index.ts`** rather than `dist/`, so `npm test` never requires a
  prior build — cross-package imports in tests resolve against
  TypeScript source via esbuild. This is a deliberate, load-bearing
  design choice for fast inner-loop testing; don't "simplify" it away.
- **Lockstep versioning across all seven publishable packages** (ADR
  0012) — not independent per-package semver. If one package's release
  cadence genuinely diverges later, that's the trigger to split it out,
  not before.

## 6. Testing — the exact current numbers and what they mean

**225 tests, 27 test files, 0 mocking the MCP protocol itself.** Full CI
on Node 20.x and 22.x via GitHub Actions
(`.github/workflows/ci.yml`) — lint, typecheck, build, `vitest run
--coverage`.

Coverage by package (see `docs/testing.md` for the exhaustive version):

| Package | Approach |
|---|---|
| `core` | Pure function unit tests — boundary cases matter more than line coverage here (see §4.4's health-score lesson) |
| `storage` | Real SQLite via `:memory:`, not a mock |
| `collector` | Spawns the REAL reference server as an actual child process; builds it lazily on first use via a shared test helper (`ensureReferenceServerBuilt`), since Node 20 can't execute `.ts` directly (ADR 0009) |
| `notifier` | Injected fake `fetch` — no real network calls, but real payload/error-handling assertions |
| `agent-interface` | A real MCP `Client` connected via the SDK's `InMemoryTransport` — genuine protocol round trips, no process spawn needed |
| `server` | Hono's in-process `app.request()` |
| `cli` | Pure logic extracted from command files (see §5) |
| `dashboard` | Pure logic only (formatting, thresholds, client-side aggregation) — **no component-rendering tests** (documented gap, not an oversight — see §9) |

**What automated tests structurally cannot catch in this project**, and
why that's an accepted, documented tradeoff rather than a blind spot:
anything about the *lifecycle of a real standalone process* (a spawned
CLI, a published package installed fresh, graceful shutdown timing). Every
instance of this class of bug found so far (§3's list) was caught by
manual, real-world verification, and each is written up as its own ADR
specifically so the *pattern* — not just the individual bug — is visible
to whoever adds the next package or command.

## 7. Documentation system — how to keep it alive

This is the part of the explicit ask ("keep track of roadmap and
regularly update the docs") that needs a concrete process, not just good
intentions:

**Every time you ship a feature or fix:**
1. Update `docs/roadmap.md`'s status table — flip the relevant P0/P1/P2
   row to ✅ (or 🚧 if partial), with a one-line note on what's real vs.
   what's still a gap. Add anything newly-discovered to the "Known
   limitations" section at the bottom rather than letting it go
   unrecorded.
2. If the change involved a non-obvious decision (a tradeoff, a bug found
   and fixed, a "we considered X but did Y because Z") — write a new ADR
   in `docs/decisions/`, numbered sequentially (`0014-...`, next). Follow
   the existing ADRs' structure: Status → Context → Decision →
   Consequences, and if a bug was involved, a dedicated section
   documenting what was believed vs. what turned out true.
3. Update `docs/architecture.md` if a package boundary or data flow
   changed; `docs/data-model.md` if an entity or algorithm changed;
   `docs/cli-reference.md` / `docs/api-reference.md` if a command or
   endpoint changed; `docs/testing.md`'s test count and coverage table.
4. Add a `CHANGELOG.md` entry under the current in-flight version (or a
   new version section if appropriate) — **never rewrite historical
   entries** to reflect later renames or changes; they should describe
   what was actually true in the repo at that point in its history (see
   how the `@mcp-reliable` → `@mattral` rename handled this in ADR 0013 —
   old entries stayed as `@mcp-reliable/*`, only the still-unreleased
   entry got updated).
5. Check `README.md` for anything now stale (install instructions, feature
   list, "not yet built" section).

**Markdown link integrity**: every doc cross-references others
extensively (`[text](./path.md)` and `[text](./path.md#anchor)`). Before
considering documentation work done, verify every local link actually
resolves — this project has done that check after every doc-touching
change throughout its history; don't stop.

## 8. What's actually done (mapped to the spec's own tiers)

**P0 — Foundation: 6.5 / 7.**
- Done: Health monitoring (`HealthChecker`, never calls a tool); per-tool
  metrics (`computeHealthScore`); basic drift detection (schema +
  output-shape); a clean CLI (`init`, `add-server`, `remove-server`,
  `servers`, `monitor`, `report`, `proxy`, `mcp`); local-first storage
  (SQLite, zero config); a web dashboard (fleet overview + server detail,
  terminal-styled).
- Partial: stdio + SSE support — `HealthChecker` supports stdio/SSE/HTTP
  for pull-based checks; the traffic-observing proxy is **stdio only**.

**P1 — Production Readiness: 5 / 7** (counting latency drift detection as
done and its output-value half as a separate, still-deferred piece — see
below).
- Done: multi-server fleet view (the dashboard); webhook + Slack alerting
  (`@mattral/notifier`, wired into both `monitor` and `proxy`); a full
  agent-facing MCP interface (`@mattral/agent-interface`, `mcp-reliable
  mcp`); historical trends (`HealthScore` snapshots feeding the
  dashboard's history chart); statistical drift detection for latency
  distributions (`detectLatencyDrift`, see
  `docs/decisions/0015-statistical-drift-detection.md`).
- Not started: statistical drift detection for output *values*
  (deliberately deferred — needs a data-retention decision, not just
  engineering time, see the ADR above); token usage tracking (blocked on
  a real product decision — which tokenizer, matching which model? — not
  just engineering time); error classification (grouping/clustering
  `Execution.errorMessage`).

**P2 — Advanced Capabilities: 0 / 5.** Cost optimization engine, custom
rule engine, OpenTelemetry exporter, ML-based anomaly detection, team
features/RBAC. None started. Per the spec's own framing this is
later-stage work, not a release blocker.

**The mechanical release itself: done.** All seven publishable packages
are live on npm as of this handoff (see §2), verified end-to-end on a
real, separate Windows machine (not just in a sandbox) — `npx
mcp-reliable@1.0.0 init`, real server registration, real `monitor` runs,
and the dashboard rendering correctly in a browser against a real,
published `@mattral/server` install, dashboard bundling included.

## 9. What's remaining, in priority order

> **Update:** items 1–3 below were addressed in a follow-up pass — see
> [`docs/decisions/0014-post-1.0-hardening-pass.md`](./docs/decisions/0014-post-1.0-hardening-pass.md)
> for the full account. Item 1 specifically still needs the maintainer's
> own `git push` (verified and diagnosed, not pushed — no write
> credentials to the real remote). Original text below left intact since
> it's still the accurate description of what needed doing and why.

1. **~~Verify/fix the `v1.0.0` git tag.~~ ✅ Verified, not yet pushed.** At
   the time of the actual publish,
   `git tag -a v1.0.0` failed with "tag already exists" — meaning a tag
   was created earlier, likely *before* the `@mattral` scope rename
   (commits happened after whatever it points to). If it points to a
   stale commit, anyone checking it out would get a version referencing
   the unavailable `@mcp-reliable` org. Check with `git log v1.0.0
   --oneline -1`; if it's not the final commit, delete and recreate it at
   HEAD, then force-push the tag.
2. **~~`README.md` needs the same real-link refresh `RELEASE_NOTES_v1.0.0.md`
   already got.~~ ✅ Done.** this was in progress when this handoff was requested
   and was NOT completed. It needs: real npm install instructions (now
   genuinely `npm install -g mcp-reliable`, confirmed working), links to
   the live npm packages, and the same "verified live, not just locally"
   framing the release notes now have.
3. **~~Small, low-risk polish items~~ ✅ All done.**, none urgent:
   - Add a `start` script to `packages/server/package.json` (currently
     the only way to run it is `node dist/index.js` directly — works
     fine, just not discoverable via `npm run`).
   - Expose `HealthChecker`'s connection timeout (10s default) as a
     `monitor --timeout` flag — found to matter when health-checking a
     server that needed `npx` to cold-install itself within that window.
   - Fix `PUBLISHING.md`'s scratch-directory example, which used a Unix
     path (`/tmp/...`) that fails on Windows `cmd.exe` — give a
     cross-platform example.
   - Document the npm CLI's own known bug
     ([npm/cli#7302](https://github.com/npm/cli/issues/7302)) that
     produces a scary-looking (but harmless, confirmed via real testing)
     `"bin[...] script name ... was invalid and removed"` warning during
     publish — not a bug in this project, worth a short note somewhere
     (`docs/testing.md` or a new small doc) so it doesn't cause alarm on
     the next publish.
4. **~~Statistical/behavioral drift detection~~ ✅ Latency half done; output-value half deliberately deferred.**
   See [`docs/decisions/0015-statistical-drift-detection.md`](./docs/decisions/0015-statistical-drift-detection.md) —
   also turned up and fixed two real pre-existing bugs along the way
   (`detectOutputShapeDrift` was dead code, and output signatures were
   being computed over the wrong data). Original scoping note, still
   accurate for what's left: Comparable in scope
   to the alerting or agent-interface work already done — one substantial
   pass. Would add a third `DriftEvent.kind` (e.g. `"statistical"`)
   alongside the existing structural detectors, per ADR 0007's own
   guidance — additive, not a replacement.
5. **Error classification** (P1). Smallest of the remaining P1 items —
   grouping/clustering `Execution.errorMessage` into common failure modes.
6. **Token usage tracking** (P1). Needs a product conversation before
   code — real token counts need a tokenizer matched to whatever model
   the calling agent uses, which this project has no way to know today.
7. **SSE/HTTP support in the traffic-observing proxy** (P0 remainder). A
   materially different technical problem than stdio proxying — there's
   no "child process" to transparently sit in front of for a network
   transport. One substantial, self-contained pass.
8. **P2, if/when there's appetite.** Treat as a real conversation about
   which items matter, not a checklist to build speculatively — team
   features alone need multi-user auth/tenancy that doesn't exist at all
   today (current design assumes one local user throughout), and ML-based
   anomaly detection is closer to a small research project than a feature
   add.

## 10. Known issues / things to just be aware of

- **Windows line-ending caution**: this project's primary development
  happened on Linux (this assistant's sandbox) but is actually *run and
  published* from Windows (the maintainer's machine, `cmd.exe`/PowerShell).
  Nothing has actually broken from this so far (verified: the shebang
  lines in compiled CLI/server output were checked and are fine either
  way), but keep an eye out if any future cross-platform artifact issue
  comes up — check line endings first, empirically, before theorizing.
- **`monitor`'s polling loop uses one shared `--interval` for every
  selected server**, not each server's own stored `healthCheckIntervalMs`
  (which is captured but not enforced).
- **`add-server` has no way to pass per-check environment variable
  overrides** for comparing two schema versions of the same server id —
  the getting-started guide's drift demo works around this by registering
  a second server id instead.
- **The dashboard's per-tool breakdown aggregates client-side** from a
  sample of recent executions, not via a dedicated server-side
  aggregation endpoint — fine up to a few hundred calls, not built for
  scale.
- **No authentication on the REST API or agent interface** — both are
  designed for local/single-user use; treat as localhost-only until that
  changes (matches the existing `SECURITY.md`'s stated caveat).
- **`npm audit` flags a dev-only `esbuild`/`vitest` advisory** — affects
  local test tooling only, not any published package's runtime code (see
  `docs/testing.md#dependency-audit-status`).

## 11. Quick-start for a new conversation picking this up

1. Read this document fully (you just did).
2. Get the actual current repo — either from the zip the user attaches,
   or by cloning `https://github.com/Mattral/mcp-reliable` if you have
   fetch access to it.
3. Skim `docs/roadmap.md` first for the single source of truth on
   status — this handoff describes it accurately as of when it was
   written, but the roadmap file is what should be kept current going
   forward, per §7's process.
4. Skim `docs/architecture.md` and the ADR index (`docs/decisions/`) for
   the "why" behind anything that looks like an unusual choice before
   assuming it's a mistake to fix.
5. Run `npm install && npm run build && npm test` before changing
   anything, to confirm your own environment matches what's expected
   (225 tests passing is the baseline as of the last update to this file
   — see `docs/roadmap.md` if that number looks stale, since it's the
   actual current source of truth per §7).
6. Whatever you build next — apply §3's verification standard: run it for
   real, in the shape it'll actually be used, before calling it done.
   Update the roadmap, write an ADR if the decision warrants one, and
   keep the CHANGELOG honest about what actually shipped versus what's
   still a gap.
