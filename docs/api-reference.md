# REST API Reference

Served by `@mattral/server` (`packages/server`). Start it with:

```
node packages/server/dist/index.js
# or, once published: npx @mattral/server
```

Configuration mirrors the CLI: `MCP_RELIABLE_DB` for the database path
(same `./.mcp-reliable/data.sqlite` default), `MCP_RELIABLE_PORT` for the
port (default `4317`). All responses are JSON. There is no authentication
layer yet — see [`roadmap.md`](./roadmap.md) and treat this as
localhost-only until that lands.

All endpoints are also directly testable without a running server: the
Hono app is built by `createApp(store)` and can be driven with
`app.request(path)` in-process — see `packages/server/test/app.test.ts`.

## `GET /api/health`

Liveness check for the API process itself (not any monitored MCP server).

```json
{ "status": "ok" }
```

## `GET /api/servers`

```json
{ "servers": [ { "id": "...", "name": "...", "transport": { "...": "env/header values redacted as \"***\"" }, "tags": [], "createdAt": 0, "healthCheckIntervalMs": 60000 } ] }
```

## `GET /api/servers/:id`

`404 { "error": "server not found" }` if unknown, otherwise `{ "server": {...} }`
(same redaction as the list endpoint).

## `GET /api/servers/:id/tools`

```json
{ "tools": [ { "id": "...", "serverId": "...", "name": "echo", "schemaFingerprint": "...", "inputSchema": {...}, "firstSeenAt": 0, "lastSeenAt": 0 } ] }
```

## `GET /api/servers/health-summary?windowMs=<ms>`

Health for every registered server in one call — what the dashboard's
fleet overview polls every 15s. Same fields as `/api/servers/:id/health`
below, plus the (redacted) `server` object and per-server alert/drift
counts, for each server.

```json
{
  "servers": [
    {
      "server": { "id": "...", "name": "...", "...": "redacted transport, as above" },
      "windowStart": 0,
      "windowEnd": 0,
      "reachabilityRate": 1,
      "lastHealthCheck": { "success": true, "at": 0 },
      "healthScore": { "score": 92.4, "...": "..." },
      "unresolvedAlertCount": 0,
      "recentDriftCount": 0
    }
  ]
}
```

## `GET /api/servers/:id/health?windowMs=<ms>`

`windowMs` defaults to 24 hours. Computes reachability from health-check
executions and a tool health score from proxy-observed executions in the
trailing window — see `data-model.md#health-vs-reachability` for why these
are two separate, possibly-null fields rather than one number.
`lastHealthCheck` is the single most recent health check regardless of the
window (so a fleet view's status dot can show "reachable right now" even
when `reachabilityRate` reflects a rockier last 24h).

```json
{
  "windowStart": 0,
  "windowEnd": 0,
  "reachabilityRate": 1,
  "lastHealthCheck": { "success": true, "at": 0 },
  "healthScore": {
    "serverId": "...",
    "windowStart": 0,
    "windowEnd": 0,
    "score": 92.4,
    "successRate": 0.98,
    "p50LatencyMs": 45,
    "p95LatencyMs": 210,
    "errorRate": 0.02,
    "sampleCount": 134
  },
  "unresolvedAlertCount": 0,
  "recentDriftCount": 0
}
```

`reachabilityRate` and `healthScore` are `null` (not omitted) when there's
no data of that kind in the window — see `data-model.md#health-vs-reachability`.
`lastHealthCheck` is `null` if no health check has ever run for this server.

## `GET /api/servers/:id/health-history?sinceMs=<epoch ms>`

Returns previously-recorded `HealthScore` snapshots (each call to `report`
or to the `/health` endpoint persists one) — the raw data a historical
trend chart would plot. `sinceMs` is optional; omit it for full history.

```json
{ "scores": [ { "serverId": "...", "windowStart": 0, "windowEnd": 0, "score": 92.4, "...": "..." } ] }
```

## `GET /api/servers/:id/executions`

Query params: `tool` (filter by tool name), `sinceMs`, `untilMs`, `limit`
(default 500, matching `ReliabilityStore.listExecutions`).

```json
{ "executions": [ { "id": "...", "serverId": "...", "toolName": "echo", "startedAt": 0, "durationMs": 12, "success": true, "outputSignature": "...", "source": "proxy" } ] }
```

## `GET /api/servers/:id/drift?sinceMs=<epoch ms>`

```json
{ "driftEvents": [ { "id": "...", "toolName": "add", "kind": "schema", "severity": "high", "description": "Input schema for tool \"add\" changed", "previousValue": "...", "newValue": "..." } ] }
```

## `GET /api/servers/:id/alerts?onlyUnresolved=true`

```json
{ "alerts": [ { "id": "...", "severity": "critical", "kind": "unreachable", "message": "Server unreachable", "triggeredAt": 0, "resolvedAt": null } ] }
```

## Not yet implemented

- Write endpoints (register/remove a server over HTTP — today that's
  CLI-only).
- Per-tool server-side aggregation (the dashboard computes this
  client-side from a sample of executions today — see
  `dashboard-design.md`).
- Authentication / API keys.
- An agent-facing MCP interface exposing this same data as MCP tools
  (P1 in the spec's roadmap — "Full MCP interface: Agents can query health,
  drift, and recommendations").
- GraphQL (mentioned as an option in the original spec's architecture
  diagram; REST has covered every need so far, so GraphQL hasn't been
  built and isn't currently planned unless a concrete need shows up).
