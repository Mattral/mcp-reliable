# mcp-reliable v1.1.0

Statistical drift detection, error classification, and — for the first
time — a `README.md` on every published package's npm page. None had one
before this release; the monorepo's own `README.md` never made it into
any individual package's tarball.

## Install / upgrade

```bash
npm install -g mcp-reliable@1.1.0
```

Or, if you're already on 1.0.0: `npm update -g mcp-reliable` picks this
up, same as any other minor version bump.

## What's new

**Statistical drift detection — the first half of it.** `detectLatencyDrift`
compares successful calls' latency *distribution* between a baseline and
recent window using a two-sample Kolmogorov-Smirnov test, catching a tool
that's gotten durably slower (or faster) even when it never crosses the
fixed p95 threshold `computeHealthScore` checks. The KS test's p-value
approximation was verified against `scipy.stats.ks_2samp` across 2,000
randomized trials before shipping — see
[`docs/decisions/0015-statistical-drift-detection.md`](./docs/decisions/0015-statistical-drift-detection.md).
Output-*value* drift (comparing the actual numbers in a response, not
just latency) is still not built — see "What's not in this release."

**Error classification.** `classifyError` sorts failures into a fixed set
of common causes (rate-limit, auth, timeout, validation, connection,
server-error) from free-text error messages; `mcp-reliable report` and the
agent interface's `get_server_health` tool both surface the breakdown, so
"why is this degraded" has an actual answer beyond a raw score. See
[`docs/decisions/0016-error-classification.md`](./docs/decisions/0016-error-classification.md).

**Two real bugs found and fixed along the way — not filed as separate
tickets, fixed as part of building on top of them:**

- `detectOutputShapeDrift` was fully built and unit-tested in 1.0.0 but
  never actually wired into any running code path — the roadmap's
  "tested against a real server" claim described manual testing, not
  anything the shipped code exercised. Now genuinely wired in and
  end-to-end tested against a real subprocess.
- Both output-shape drift and error classification depend on reading the
  real content of an MCP tool result — and both were, until this release,
  hashing or discarding that content instead of reading it.
  `computeOutputSignature` was being run against MCP's transport-level
  `content` wrapper (`[{type:"text", text:"..."}]`, identical in shape
  regardless of what JSON is embedded in `text`), and every tool-level
  `isError: true` failure's real error text was being replaced with one
  generic placeholder string. Both fixed (`extractOutputPayload`,
  `extractErrorMessage`), both unit-tested against the exact
  reproduction of the bug they fix.

**`monitor --timeout`.** `HealthChecker`'s connection timeout (10s
default) is now a CLI flag, not hard-coded — useful for a server that
needs `npx` to cold-install itself within the check window.

**Dependency audit.** `npm audit fix` (non-breaking) applied, resolving
seven findings that had appeared since 1.0.0. Two remain, both traced and
confirmed unreachable in this project's actual usage — see
[`docs/testing.md#dependency-audit-status`](./docs/testing.md).

Full details on all of the above, plus a handful of smaller polish items
(a `start` script for `@mattral/server`, cross-platform fixes to
`PUBLISHING.md`), in [`CHANGELOG.md`](./CHANGELOG.md).

## Built with the same testing discipline as 1.0.0

256 tests now (up from 195), still none of them mocking the MCP protocol
itself. Both bugs described above were caught by an end-to-end test
against a real subprocess, not by reasoning about the code — the same
pattern the 1.0.0 release notes described for that release's four bugs,
holding again here.

## What's not in this release

Still honest, still on purpose — see
[`docs/roadmap.md`](./docs/roadmap.md) for the full picture:

- **Output-*value* drift** (statistically comparing the actual numbers in
  a tool's response, not just latency) — deliberately deferred. It would
  need to start storing real numeric values extracted from tool outputs,
  which nothing in this system does today and which has real privacy
  surface; that's a data-retention decision, not just an engineering
  pass.
- **Token usage tracking** — still blocked on a real product question
  (which tokenizer, matching which model?), not engineering time.
- **SSE/HTTP support in the traffic-observing proxy** — still stdio only.
  A materially different technical problem, since there's no child
  process to transparently sit in front of for a network transport.
- **A dashboard visualization for the error-category breakdown** — the
  CLI and agent interface have it; the web dashboard doesn't yet. A
  clean, well-scoped follow-up, not started this release to avoid
  rushing it into an already-large one.
- All of P2 (cost optimization, a custom rule engine, OpenTelemetry
  export, ML-based anomaly detection, team features/RBAC).

## Thanks

Built by [Min Htet Myet (Mattral)](https://github.com/Mattral). MIT
licensed — see [`LICENSE`](./LICENSE). Issues and contributions welcome;
see [`CONTRIBUTING.md`](./CONTRIBUTING.md).
