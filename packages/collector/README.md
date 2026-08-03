# @mattral/collector

Health checking and traffic-observing proxy collectors for MCP servers —
the data-collection layer of [mcp-reliable](https://www.npmjs.com/package/mcp-reliable).

```bash
npm install @mattral/collector
```

## What's in it

- **`HealthChecker`** — periodic reachability + latency checks against a
  registered server (`initialize` handshake + `tools/list`), with a
  configurable connection timeout.
- **`StdioProxyCollector`** — sits transparently between a real MCP client
  and a real stdio server, forwarding every message unmodified while
  recording each execution and running drift detection (schema,
  output-shape, statistical/latency) against real traffic.
- **`extractOutputPayload`** / **`extractErrorMessage`** — correctly
  unwrap MCP's `content` block convention to get at a tool's actual output
  or error text, instead of the transport-level envelope around it.

## Learn more

See the [mcp-reliable GitHub repo](https://github.com/Mattral/mcp-reliable),
particularly `docs/architecture.md` for how health checks and the proxy
each observe a server differently, and `docs/decisions/` for the
reasoning behind the extraction helpers above.

## License

MIT
