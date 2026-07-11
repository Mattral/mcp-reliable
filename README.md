# mcp-reliable

Runtime observability and reliability for the Model Context Protocol
ecosystem. Where tools like `mcp-observatory` audit servers before
deployment and `inspector` helps you debug one by hand, `mcp-reliable`
watches servers *while they're running*: is this server up right now, is a
given tool getting slower or less reliable over time, and did its schema or
output shape just change out from under the agents calling it.

Full design rationale lives in [`docs/`](./docs) — start with
[`docs/architecture.md`](./docs/architecture.md) if you want the "how" and
[`docs/roadmap.md`](./docs/roadmap.md) for exactly what's implemented vs.
planned. This README is the fast path to running it.

## What's actually here today

- **Health checks** — connect to a server, confirm it's reachable, list its
  tools, detect schema changes. Never calls a tool (see
  [why](./docs/architecture.md#collection-model)).
- **A traffic-observing proxy** — wrap a real `stdio` MCP server with one
  command-line change and get real per-call latency, success/failure, and
  output-shape drift detection, with zero changes to the server itself.
- **A CLI** (`mcp-reliable`) — `init`, `add-server`, `remove-server`,
  `servers`, `monitor`, `report`, `proxy`. See
  [`docs/cli-reference.md`](./docs/cli-reference.md).
- **A REST API** — everything above, queryable over HTTP, redacting secrets
  from any transport config it returns. See
  [`docs/api-reference.md`](./docs/api-reference.md).
- **A web dashboard** — a fleet overview and per-server detail page (health
  history, tool breakdown, drift/alerts, execution log), served as static
  assets by the same REST API process. See
  [`docs/dashboard-design.md`](./docs/dashboard-design.md).
- **Webhook and Slack alerting** — `monitor` and `proxy` both open/resolve
  alerts (unreachable, health degradation, drift) and deliver them via
  `--webhook`/`--slack-webhook`. See
  [`docs/decisions/0010-alerting-notifier-design.md`](./docs/decisions/0010-alerting-notifier-design.md).
- **An agent-facing MCP interface** — `mcp-reliable mcp` exposes health,
  drift, alerts, and a synthesized should-I-use-this recommendation as MCP
  tools, so an agent can query mcp-reliable directly. See
  [`docs/decisions/0011-agent-interface-design.md`](./docs/decisions/0011-agent-interface-design.md).
- **SQLite storage**, zero config, one file per project.

Not yet built: SSE/HTTP support in the traffic-observing proxy (and the
agent interface, which is also stdio-only for now), statistical drift
detection, token tracking, and the rest of P2 in
[`docs/roadmap.md`](./docs/roadmap.md).

## Quick start

Requires Node.js 20+.

```bash
git clone <this-repo>
cd mcp-reliable
npm install
npm run build
npm test   # 190+ tests, none of them mocked at the protocol level — see docs/testing.md
```

Then walk through [`docs/getting-started.md`](./docs/getting-started.md),
which uses the bundled `examples/reference-mcp-server` so there's nothing
external to stand up first:

```bash
node packages/cli/dist/index.js init
node packages/cli/dist/index.js add-server \
  --name reference --stdio -- node examples/reference-mcp-server/dist/index.js
node packages/cli/dist/index.js monitor --server reference --once
```

Once installed globally or linked (`npm link` inside `packages/cli`), all
of the above is just `mcp-reliable ...`.

## Project layout

```
packages/core        pure data model, health scoring, drift detection (no I/O)
packages/storage      SQLite persistence behind a storage-agnostic interface
packages/collector    health checks + the traffic-observing stdio proxy
packages/notifier     webhook and Slack alert delivery
packages/agent-interface   agent-facing MCP tools (health, drift, alerts, recommendations)
packages/cli          the mcp-reliable command-line tool
packages/server       REST API over stored data, serves the built dashboard
packages/dashboard    React + Tailwind web dashboard (fleet overview + server detail)
examples/             a tiny reference MCP server used by tests and the getting-started guide
docs/                 architecture, data model, CLI/API reference, ADRs, roadmap
```

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Short version: `npm run lint &&
npm run build && npm test` should all be clean before opening a PR, and any
change to `core`'s algorithms should come with a test that would have
caught the bug if you'd gotten it wrong — see
[`docs/decisions/0005-health-score-formula.md`](./docs/decisions/0005-health-score-formula.md)
for a real example of exactly that happening during this project's own
development.

## License

MIT — see [`LICENSE`](./LICENSE).
