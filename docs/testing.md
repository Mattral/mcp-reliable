# Testing

## Running the suite

```
npm install
npm test              # vitest run, across every package
npm run build          # tsc -b, full type check + dist output for every package
npm run lint            # eslint .
```

`npm test` does **not** require `npm run build` first: `vitest.config.ts`
aliases each workspace package name (`@mcp-reliable/core`, `/storage`,
`/collector`) directly to its `src/index.ts`, so cross-package imports in
tests resolve against TypeScript source via esbuild, not compiled `dist/`
output. This keeps the inner test loop fast and independent of build order.
`npm run build` (via TypeScript project references, `tsc -b`) is what
produces the real `dist/` output the CLI and server actually run from, and
is what CI type-checks against.

One documented exception: `examples/reference-mcp-server` is spawned as a
real OS process by the collector's integration tests, so it can't use the
alias trick above (there's no `import` to alias). The test suite builds it
itself, once, the first time it's needed — see
["Why integration tests spawn a real process"](#why-integration-tests-spawn-a-real-process)
below. This adds a few seconds to the first collector test that runs it,
not a manual step.

## What's covered

As of this writing: **193 tests, 0 failing**, across every package.

| Package | What's tested |
|---|---|
| `core` | Schema/output-shape fingerprinting stability and sensitivity (key-order independence, type changes, array bucketing); percentile correctness (median, p95, order-independence, clamping); the full health-score formula (perfect/failing/slow servers, the success-rate gating behavior, drift-penalty capping, score bounds); schema and output-shape drift detection (first-observation handling, unchanged-fingerprint handling, dominance thresholds, severity bands). |
| `storage` | Every `ReliabilityStore` method round-tripped through real SQLite (`:memory:`), including upsert idempotency, cascading deletes, time/tool-name filtering on executions, and foreign-key enforcement. |
| `collector` | The JSON-RPC framer (chunked messages, multiple messages per chunk, malformed-line handling) in isolation; `HealthChecker` and `StdioProxyCollector` **against the real reference MCP server as an actual child process** — not mocked — covering tool listing, successful and failing (isError) tool calls, schema-drift detection across two sessions, and an unreachable-server case. |
| `notifier` | `WebhookNotifier` and `SlackNotifier` against an injected fake `fetch` (payload shape, header merging, non-ok-status handling, and — for the webhook — that a server's transport/secrets never appear in the delivered payload); `CompositeNotifier`'s failure isolation between multiple notifiers; the `createNotifier` factory's option-to-implementation mapping. No test hits a real network endpoint. |
| `agent-interface` | Every tool, via a real MCP `Client` connected to the real `McpServer` over the SDK's `InMemoryTransport` — genuine protocol round trips (`listTools`, `callTool`), no mocking of MCP itself, but no process spawned either. Covers the full tool list, unknown-server-id error results, secret redaction in `list_servers`, and each recommendation level. `computeAgentHealthSummary` separately covers the "reflects latest check, not an aggregate" and "never persists a snapshot" behaviors against a seeded store. |
| `cli` | Pure logic extracted for testability: duration parsing, shell-like tokenizing, slugify, transport resolution (`add-server`'s mutually-exclusive-flags logic), `buildServerReport`'s reachability/health-score separation, and the full alert-reconciliation surface (`reconcileUnreachableAlert`, `reconcileHealthDegradationAlert`, `recordDriftAlerts`) — open/resolve/no-duplicate state machines for all three `Alert` kinds. |
| `server` | Every REST endpoint via Hono's in-process `app.request()`, including the 404 cases, transport-secret redaction, the batch `health-summary` endpoint, and the dashboard static-file mounting helper (built vs. not-built, and asset serving) against a real temp directory. |
| `dashboard` | Pure logic only: formatting/threshold helpers (mirrored against the CLI's exact score/severity bands) and the client-side per-tool aggregation logic. No component-rendering tests yet — see "what's not covered" below. |

### Why integration tests spawn a real process

`HealthChecker` and `StdioProxyCollector` are tested against
`examples/reference-mcp-server` run as an actual `node` child process. This
was a deliberate choice over mocking the MCP SDK's `Client`/transport
internals: the whole point of the collector package is correctly speaking
the real wire protocol, and a hand-rolled mock of that protocol would risk
testing the mock's model of MCP rather than mcp-reliable's actual behavior
against it. The proxy tests go one step further and drive a real SDK
`Client` through a custom in-memory `Transport`
(`packages/collector/test/helpers/stream-pair-transport.ts`) piped into the
proxy's `input`/`output` stream options, so the full client → proxy → child
→ proxy → client round trip is exercised for real.

Spawning a real process means this is the one place in the test suite that
can't use vitest's src-aliasing (see above) — a spawned OS process is never
`import`ed, so there's no module resolution to alias. The tests build the
reference server once, lazily, via a shared helper
(`packages/collector/test/helpers/ensure-reference-server-built.ts`) and
spawn the compiled `dist/index.js`, rather than the `.ts` source directly.
This wasn't the original design — see
[`decisions/0009-reference-server-must-be-built-for-tests.md`](./decisions/0009-reference-server-must-be-built-for-tests.md)
for what broke and why.

### What's not covered yet

- The `monitor` and `report` CLI commands' *top-level* `action()` wiring
  (argument parsing → command function) isn't tested end-to-end; the pure
  logic each delegates to is. A full CLI-process integration test (spawn
  `mcp-reliable`, assert on stdout) is a reasonable addition once the
  command surface stabilizes further.
- The dashboard has no component-rendering tests (no `@testing-library/react`
  + jsdom setup) — only its pure logic (formatting, thresholds, client-side
  aggregation) is unit tested. The build itself is verified by actually
  running `vite build` and serving the output (see the manual verification
  notes in `docs/decisions/0008-dashboard-stack-and-duplication.md`'s
  surrounding development), but there's no automated regression check that,
  say, `FleetOverview` still renders a row per server after a refactor.
- The graceful-shutdown notification handling in `proxy.ts` (awaiting
  in-flight webhook/Slack deliveries before the process exits, on both a
  natural child-process exit and `SIGINT`/`SIGTERM`) has no automated
  test — it was found *and* verified by hand (a real mock HTTP receiver, a
  real spawned proxy process, killed at the exact moment that used to lose
  the notification) rather than by the `vitest` suite. See
  `docs/decisions/0010-alerting-notifier-design.md` for the full account.
  An automated version of that reproduction is a reasonable addition, but
  risks being either flaky (real timing) or not actually exercising the
  race it's meant to catch (if too deterministic) — worth designing
  carefully rather than bolting on quickly.
- Similarly, `agent-interface`'s store-closing-too-early bug (see
  `docs/decisions/0011-agent-interface-design.md`) was invisible to the
  `InMemoryTransport`-based test suite — those tests never exercise the
  CLI's `openStore` → `runAgentServerOnStdio` → `store.close()` lifecycle,
  only the tool-call protocol itself. It was caught by actually spawning
  `mcp-reliable mcp` as a real process and driving it with a real `Client`
  end to end. This is the same shape of gap as the proxy notification bug
  above: fast, mocked-transport unit tests and "run it for real" checks
  catch genuinely different classes of bug, and this project has now hit
  that twice.
- SSE and streamable-HTTP transports have no integration test (no
  reference server implementing them yet) — only `stdio` is exercised
  end-to-end today.
- Load/concurrency behavior of `SqliteStore` under many simultaneous writers
  (WAL mode is enabled, but there's no test asserting it holds up under
  contention).

## Dependency audit status

`npm audit` reports vulnerabilities in `esbuild` (via `vite`/`vitest`'s dev
server) — specifically a known CORS-related issue in esbuild's development
server that allows any website to send requests to it and read the
response. This affects `vitest`'s local dev/watch tooling only; it is not a
runtime dependency of `core`, `storage`, `collector`, `cli`, or `server`,
and ships in none of their `dist/` output or published packages. Upgrading
`vitest` to a major version with a patched `esbuild` is a reasonable
follow-up (tracked in `roadmap.md`) but wasn't treated as urgent given the
above — do your own `npm audit` before relying on this assessment, since
advisories change.
