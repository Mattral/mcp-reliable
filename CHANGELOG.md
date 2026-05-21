# Changelog

## 0.1.0 — Initial P0 foundation

First implementation pass against `mcp-reliable-project-spec.md`. See
[`docs/roadmap.md`](./docs/roadmap.md) for the full status table against
the spec's P0/P1/P2 feature lists; summary of what's new since there was no
prior version:

**Added**

- `@mcp-reliable/core` — data model (Server/Tool/Execution/HealthScore/
  DriftEvent/Alert), schema and output-shape fingerprinting, the health
  score formula, schema and output-shape drift detection.
- `@mcp-reliable/storage` — `ReliabilityStore` interface + a SQLite
  (`better-sqlite3`) implementation.
- `@mcp-reliable/collector` — `HealthChecker` (pull-based, never invokes a
  tool) and `StdioProxyCollector` (transparent traffic-observing proxy for
  stdio servers).
- `@mcp-reliable/cli` — `mcp-reliable init|add-server|remove-server|servers|monitor|report|proxy`.
- `@mcp-reliable/server` — a REST API (Hono) over everything above, with
  transport-secret redaction.
- `examples/reference-mcp-server` — a 3-tool stdio MCP server (echo, add,
  flaky) used by the integration test suite and the getting-started guide,
  including a built-in demo-mode switch for triggering schema/output drift
  on demand.
- Full documentation set under `docs/` (architecture, data model, CLI/API
  reference, getting-started, testing strategy, dashboard design doc, 7
  ADRs) plus this roadmap.
- CI (GitHub Actions): lint, type-check/build, and test on Node 20.x and
  22.x.
- 104 tests across every package, including integration tests that spawn
  the reference server as a real process rather than mocking the MCP
  protocol.

**Known gaps** (see `docs/roadmap.md` for the complete list): no web
dashboard yet (design-only), SSE/HTTP not supported by the traffic-
observing proxy (only pull-based health checks), no statistical drift
detection, no token-usage tracking, no webhook/Slack alerting, no
agent-facing MCP interface.
