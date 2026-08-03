# @mattral/agent-interface

An agent-facing MCP interface exposing
[mcp-reliable](https://www.npmjs.com/package/mcp-reliable)'s own health,
drift, and recommendation data as MCP tools — so an agent can query the
reliability of the *other* MCP servers it depends on, directly, as part
of its own reasoning.

```bash
npm install @mattral/agent-interface
```

Typically run via the CLI (`mcp-reliable mcp`), not used standalone —
this package is the tool-registration layer that command wraps.

## Tools exposed

- `list_servers` — every server mcp-reliable is tracking.
- `get_server_health` — reachability, tool health score, and a classified
  breakdown of recent failures by likely cause.
- `list_drift_events` — detected schema, output-shape, or statistical
  changes for a server.
- `list_alerts` — open and resolved alerts.
- `get_recommendation` / `list_recommendations` — a prioritized verdict
  (healthy / caution / avoid) with a plain-language reason.

## Learn more

See the [mcp-reliable GitHub repo](https://github.com/Mattral/mcp-reliable)
for the full tool reference and how this fits into the rest of the
system.

## License

MIT
