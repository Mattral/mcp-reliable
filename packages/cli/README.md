# mcp-reliable

Runtime observability and reliability for the Model Context Protocol
ecosystem: health checks, a traffic-observing proxy, drift detection
(structural and statistical), error classification, webhook/Slack
alerting, and an agent-facing MCP interface — all from one CLI.

```bash
npm install -g mcp-reliable
mcp-reliable init
mcp-reliable add-server --name my-server --stdio -- npx my-mcp-server
mcp-reliable monitor
```

## What it does

- **`mcp-reliable monitor`** — periodic health checks against every
  registered server: reachable or not, latency percentiles, a rolling
  health score, drift alerts, webhook/Slack notifications.
- **`mcp-reliable proxy`** — sits transparently between a real MCP client
  and a real server over stdio, observing live `tools/call` traffic to
  catch schema drift, output-shape drift, and statistical latency drift
  as it happens — not just at the next scheduled check.
- **`mcp-reliable report`** — a point-in-time summary for any time window:
  reachability, tool health, latency, drift, and a classified breakdown
  of recent failures by likely cause (rate-limit, auth, timeout, etc.).
- **`mcp-reliable mcp`** — exposes mcp-reliable's own health, drift, and
  recommendation data as MCP tools, so an agent can query its own
  infrastructure's reliability directly.

## Learn more

Full documentation, architecture, and design rationale live in the
[GitHub repo](https://github.com/Mattral/mcp-reliable) — start with the
[README](https://github.com/Mattral/mcp-reliable#readme) for a complete
walkthrough, or `docs/cli-reference.md` for every command and flag.

This package is the CLI; it depends on the same-scoped
[`@mattral/core`](https://www.npmjs.com/package/@mattral/core),
[`@mattral/storage`](https://www.npmjs.com/package/@mattral/storage),
[`@mattral/collector`](https://www.npmjs.com/package/@mattral/collector),
[`@mattral/notifier`](https://www.npmjs.com/package/@mattral/notifier), and
[`@mattral/agent-interface`](https://www.npmjs.com/package/@mattral/agent-interface)
libraries, which are also independently usable if you're building your own
tooling on top of mcp-reliable's primitives.

## License

MIT
