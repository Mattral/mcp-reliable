# mcp-reliable v1.0.0

**Runtime observability and reliability for the Model Context Protocol
ecosystem.** Where tools like `mcp-observatory` audit servers before
deployment and `inspector` helps you debug one by hand, `mcp-reliable`
watches servers *while they're running* — is this server up right now, is
a tool getting slower or less reliable over time, and did its schema or
output shape just change out from under the agents calling it.

This is the first stable release: the foundation (health checks, a
traffic-observing proxy, drift detection, local-first SQLite storage, a
CLI) plus most of what the original design called "production readiness"
(a web dashboard, webhook/Slack alerting, and an agent-facing MCP
interface) are all here, tested, and documented.

## Install

```bash
npm install -g mcp-reliable
mcp-reliable init
mcp-reliable add-server --name my-server --stdio -- npx my-mcp-server
mcp-reliable monitor --server my-server --once
```

See [`docs/getting-started.md`](./docs/getting-started.md) for the full
walkthrough (it uses a bundled reference server, so there's nothing
external to stand up first) and [`README.md`](./README.md) for the rest of
the docs.

## What's in this release

**Health checks that never call a tool.** `mcp-reliable monitor` connects
to a server, confirms it's reachable, lists its tools, and disconnects —
deliberately never invoking a tool itself, since a monitoring process has
no way to know that's safe to do.

**A traffic-observing proxy that needs zero code changes.** Point your
agent's launch config at `mcp-reliable proxy my-server -- <original
command>` instead of the original command, and every real tool call gets
recorded — latency, success/failure, output-shape drift — with the
wrapped server's source untouched.

**Drift detection, structural and schema-level.** A tool's input schema
changing, or its output's shape (keys, nesting, types — never values)
durably shifting, both get caught and surfaced as `DriftEvent`s.

**A health score that actually means something.** Composite 0–100 score
gating on success rate first (a server failing 100% of calls scores 0, no
matter how fast the failures return — a real bug in an earlier version of
this exact formula, found by a test and fixed; see ADR 0005), with latency
shaping the score within whatever ceiling the success rate sets.

**A web dashboard.** A dense, terminal-styled fleet overview and a
per-server detail page (health history, per-tool breakdown, drift/alerts,
a recent-executions log) — served as static assets by the same process
that runs the REST API, no second thing to stand up.

**Webhook and Slack alerting.** Unreachable, health-degradation
(transition-based — one alert when a server crosses into trouble, not one
per poll while it stays there), and drift alerts, delivered via
`--webhook`/`--slack-webhook` on both `monitor` and, for live-traffic
drift, `proxy` itself.

**An agent-facing MCP interface.** `mcp-reliable mcp` exposes
mcp-reliable's own data as MCP tools — `list_servers`,
`get_server_health`, `list_drift_events`, `list_alerts`,
`get_recommendation`, `list_recommendations` — so an agent can ask "should
I use this tool right now" directly, not just a human reading a terminal
or a browser.

## Built with a real testing discipline, not just a test count

195 tests, none of them mocking the MCP protocol itself — collector
integration tests spawn the real reference server as an actual process;
the agent interface is driven by a real MCP `Client` over the SDK's
`InMemoryTransport`; the REST API is tested via Hono's in-process
`app.request()`. Full CI on Node 20.x and 22.x.

More importantly: four real bugs were caught by *not* trusting the
automated suite alone, and are written up honestly rather than fixed
silently, because each one taught something re-usable:

- A health-score formula that gave a 100%-failing server partial credit
  for failing fast (ADR 0005).
- A CI failure on Node 20 because the reference server was being spawned
  from unbuilt `.ts` — Node's built-in TypeScript support is 22.6+ only,
  and this project supports Node 20+ (ADR 0009).
- A notification that could be lost if the proxy process exited before
  an in-flight webhook `fetch()` completed (ADR 0010).
- The agent interface's database connection closing before any tool call
  could run, because `server.connect()` resolves on handshake, not
  session end (ADR 0011).

Every one of these was found by actually running the thing end-to-end,
not by the (still valuable, still passing) unit tests — a pattern worth
knowing about this codebase if you're extending it.

## What's not in this release

Honestly, on purpose — see [`docs/roadmap.md`](./docs/roadmap.md) for the
full picture:

- The traffic-observing proxy is **stdio only** — SSE/HTTP live-traffic
  proxying is a different technical problem, not built yet.
- **Statistical drift detection** (comparing output *values* or latency
  *distributions*, not just shape) isn't built — today's detectors catch
  structural changes reliably, not subtler value-level drift.
- **Token usage tracking** is blocked on a real product question (which
  tokenizer, matching which model?), not just engineering time.
- **Error classification**, and all of P2 (cost optimization, a custom
  rule engine, OpenTelemetry export, ML-based anomaly detection, team
  features/RBAC) haven't been started.

## Thanks

Built by [Min Htet Myet (Mattral)](https://github.com/Mattral). MIT
licensed — see [`LICENSE`](./LICENSE). Issues and contributions welcome;
see [`CONTRIBUTING.md`](./CONTRIBUTING.md).
