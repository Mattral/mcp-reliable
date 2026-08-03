# @mattral/server

A REST API exposing [mcp-reliable](https://www.npmjs.com/package/mcp-reliable)'s
stored reliability data, and the web dashboard that consumes it.

```bash
npm install -g @mattral/server
mcp-reliable-server
```

Reads the same SQLite database `mcp-reliable monitor`/`proxy` write to,
so run this alongside the CLI to get a live fleet-overview dashboard —
see the main [mcp-reliable GitHub repo](https://github.com/Mattral/mcp-reliable)
for the full setup walkthrough.

## API

`GET /api/servers`, `/api/servers/:id`, `/api/servers/:id/health`,
`/api/servers/:id/executions`, `/api/servers/:id/drift`,
`/api/servers/:id/alerts`, `/api/servers/:id/health-history` — see
`docs/architecture.md` in the GitHub repo for the full reference.

## License

MIT
