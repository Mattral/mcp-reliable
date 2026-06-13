# Getting Started

This walks through the whole loop — register a server, watch its health,
send it real traffic through the proxy, see a reliability report, and
trigger a live drift detection — using the bundled reference MCP server
(`examples/reference-mcp-server`), so there's nothing external to install
first.

Run everything from the repository root after `npm install && npm run build`
(see the root [`README.md`](../README.md) for the one-time setup).

## 1. Initialize

```
node packages/cli/dist/index.js init
```

```
✓ mcp-reliable initialized at /you/are/here/.mcp-reliable/data.sqlite

Next step — register a server to monitor:
  mcp-reliable add-server --name my-server --stdio -- npx my-mcp-server
```

From here on this guide writes `mcp-reliable` for brevity — if you haven't
installed it globally, substitute `node packages/cli/dist/index.js`, or
`npm link` inside `packages/cli` first.

## 2. Register the reference server

```
mcp-reliable add-server --name reference --stdio -- node examples/reference-mcp-server/dist/index.js
```

## 3. Check it's alive

```
mcp-reliable monitor --server reference --once
```

```
mcp-reliable monitor  10:03:12 AM
┌───────────┬─────────────┬─────────┬───────┬───────┐
│ Server    │ Status      │ Latency │ Tools │ Drift │
├───────────┼─────────────┼─────────┼───────┼───────┤
│ reference │ ● reachable │ 210ms   │ 3     │ none  │
└───────────┴─────────────┴─────────┴───────┴───────┘
```

This connected as a client, listed the reference server's three tools
(`echo`, `add`, `flaky`), and disconnected — it did **not** call any of
them (see `architecture.md#collection-model` for why).

## 4. Send it real traffic through the proxy

The reference server's `flaky` tool fails about 25% of the time and has
randomized latency, specifically so there's something interesting to see
here. Point any MCP client at the proxy instead of the server directly:

```
mcp-reliable proxy reference -- node examples/reference-mcp-server/dist/index.js
```

Point your agent/IDE's MCP server launch config at that command (see
`cli-reference.md#mcp-reliable-proxy` for the exact config-file change), or
drive it with any MCP client library for a quick manual test. Every
`tools/call` your client makes now gets recorded.

## 5. See the report

After some real traffic has flowed through the proxy:

```
mcp-reliable report --server reference --last 1h --drift
```

```
reference (reference)
  Reachability: 100.0%
  Tool health score: 61.3 / 100  (12 calls)
  Success rate: 66.7%
  Latency: p50 340ms, p95 780ms
  Drift: none detected in this window
```

The tool health score reflects real traffic; reachability reflects health
checks — they're reported separately on purpose (`data-model.md#health-vs-reachability`).

## 6. Trigger a live drift detection

The reference server has a `MCP_RELIABLE_DEMO_MODE=v2` switch built in
specifically for this: it changes `echo`'s output shape and adds an
optional `roundTo` parameter to `add`'s input schema — exactly the kind of
change `mcp-reliable`'s drift detector exists to catch.

Run a health check against the "v2" version of the same server id:

```
mcp-reliable remove-server reference   # start clean for the demo
mcp-reliable add-server --name reference --stdio -- node examples/reference-mcp-server/dist/index.js
mcp-reliable monitor --server reference --once      # baseline: records today's schema

# Now simulate the server being deployed with a changed API:
MCP_RELIABLE_DEMO_MODE=v2 mcp-reliable monitor --server reference --once
```

That second run's transport doesn't have the env var wired in by the CLI
today (`add-server` doesn't yet expose per-check env overrides — see
`roadmap.md`), so to see it end-to-end right now, use the proxy directly
with the collector library, or register a second server pointed at the
same command with the env var baked into its transport:

```
mcp-reliable add-server --name reference-v2 --stdio -- env MCP_RELIABLE_DEMO_MODE=v2 node examples/reference-mcp-server/dist/index.js
mcp-reliable monitor --server reference-v2 --once
```

Since `reference-v2` is a fresh server id, this alone won't show drift
(there's no prior fingerprint to compare against for *that* id) — drift
shows up when the **same** server id is checked twice with different
schemas, which is exactly what the collector integration tests do
(`packages/collector/test/health-checker.test.ts`) if you want to see the
detector fire in a controlled way right now.

## 7. Run the REST API and dashboard

The dashboard is optional — build it once if you want it (part of the root
`npm run build`, or standalone):

```
cd packages/dashboard && npm run build && cd ../..
```

Then start the server either way:

```
node packages/server/dist/index.js
```

With the dashboard built:

```
mcp-reliable server listening on http://localhost:4317 (db: ./.mcp-reliable/data.sqlite)
Dashboard: http://localhost:4317/
```

Open `http://localhost:4317/` for the fleet overview (a live, clickable
version of what `mcp-reliable servers`/`monitor` prints in the terminal),
or `http://localhost:4317/#/servers/reference` directly for the detail
page — health history, per-tool breakdown, drift/alerts, and a recent-
executions log. See [`dashboard-design.md`](./dashboard-design.md) for
what's there and what isn't yet.

Without the dashboard built, the log line says so and the REST API still
works on its own:

```
curl http://localhost:4317/api/servers
curl http://localhost:4317/api/servers/reference/health
curl "http://localhost:4317/api/servers/reference/executions?tool=echo"
```

See [`api-reference.md`](./api-reference.md) for the full endpoint list.
