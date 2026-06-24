# CLI Reference

All commands read/write a local SQLite database, resolved in this order:
`--db <path>` flag → `MCP_RELIABLE_DB` environment variable → `./.mcp-reliable/data.sqlite`
relative to the current directory. There is no global install state —
everything is project-local, matching the "zero friction for individuals and
small teams" storage principle from the spec.

Global note on errors: commands print a friendly one-line message (and a
hint, where there's an obvious fix) instead of a raw stack trace. Set
`MCP_RELIABLE_DEBUG=1` to see the full stack when troubleshooting
`mcp-reliable` itself.

Built with Commander + chalk + cli-table3 + ora rather than the Ink-based
TUI the original spec's stack table proposed — see
[`decisions/0004-cli-framework-choices.md`](./decisions/0004-cli-framework-choices.md)
for why, and what would bring Ink back into scope.

## `mcp-reliable init`

Creates `./.mcp-reliable/` and the SQLite database if they don't already
exist. Safe to run again — reports what's already tracked instead of
erroring.

```
mcp-reliable init
mcp-reliable init --db ./custom-path/data.sqlite
```

## `mcp-reliable add-server`

Registers a server to monitor.

```
--name <name>       required. Also slugified into the server's id.
--stdio [command]   a stdio transport. Either a quoted string ("npx my-server --flag"),
                     or omit the value and put the real command after `--`.
--sse <url>          an SSE transport
--http <url>          a streamable HTTP transport
--tag <tag>          repeatable
--interval <ms>      health check interval metadata (default 60000)
--db <path>
```

Exactly one of `--stdio` / `--sse` / `--http` is required.

```
# Quoted form — fine for simple commands with no special characters
mcp-reliable add-server --name my-server --stdio "npx my-mcp-server"

# -- form — required for commands with quoted arguments, env-like flags, etc.
mcp-reliable add-server --name my-server --stdio -- npx my-mcp-server --flag "some value"

mcp-reliable add-server --name remote-search --sse https://example.com/mcp/sse
mcp-reliable add-server --name remote-search --http https://example.com/mcp
```

If a server with the same id (derived from `--name`) is already registered,
this errors with a hint to `remove-server` it first — it will not silently
overwrite.

## `mcp-reliable remove-server <id>`

Deletes a server and (via `ON DELETE CASCADE`) all of its tools, executions,
drift events, health-score history, and alerts.

```
mcp-reliable remove-server my-server
```

## `mcp-reliable servers`

Lists registered servers in a table: id, name, transport summary, tags,
configured check interval.

## `mcp-reliable monitor`

Polls registered servers on an interval and renders a live status table
(reachability, latency, tool count, newly-detected drift). Also reconciles
and, if configured, delivers alerts every tick:

- **unreachable** — opens/resolves as reachability flaps
- **health-degradation** — opens/resolves as a fresh trailing-window
  health score crosses between healthy/warning/critical bands (not on
  every tick a server stays degraded — see `data-model.md#alert`)
- **drift** — one alert per schema-drift event a health check finds
  (no "resolved" state)

```
--server <id>     only monitor this one server (default: all registered)
--once            run a single pass and exit — useful in CI/scripts
--interval <ms>   polling cadence (default 30000). Applies to every
                  selected server on one shared tick; see the honesty
                  note in architecture.md about per-server intervals.
--window <ms>     trailing window for health-degradation scoring (default
                  3600000, i.e. 1h)
--webhook <url>          POST a JSON payload when an alert opens or resolves
--slack-webhook <url>    post to a Slack incoming-webhook URL when an alert opens or resolves
--db <path>
```

```
mcp-reliable monitor                       # live view of every server, every 30s, until Ctrl+C
mcp-reliable monitor --server my-server --once
mcp-reliable monitor --interval 5000
mcp-reliable monitor --webhook https://example.com/hooks/mcp-reliable
mcp-reliable monitor --slack-webhook https://hooks.slack.com/services/…
```

Both `--webhook` and `--slack-webhook` can be set together — every alert
goes to both, and one failing to deliver doesn't block the other (see
`decisions/0010-alerting-notifier-design.md`).

## `mcp-reliable report`

Summarizes reliability over a trailing time window: reachability (from
health checks), a tool health score (from real proxy-observed traffic, if
any), and — with `--drift` — the drift events detected in that window. Also
persists a `HealthScore` snapshot for historical trending.

```
--server <id>        only report on this one server (default: all registered)
--last <duration>     e.g. "1h", "24h", "7d", or a combination like "1d12h" (default 24h)
--drift               include a detailed drift-event listing
--db <path>
```

```
mcp-reliable report --last 7d --drift
mcp-reliable report --server my-server --last 1h
```

## `mcp-reliable proxy <server-id> -- <command> [args...]`

Wraps a real MCP server: spawns `<command> [args...]` as a child process and
transparently forwards all JSON-RPC traffic between it and whatever real
client launches this command, recording every tool call and detecting drift
as it goes. If `<server-id>` isn't already registered, it's auto-registered
using the given command as its `stdio` transport.

**Point your agent's MCP server configuration at this command instead of
the original one** — that's the entire integration step.

```
--webhook <url>          POST a JSON payload when drift is detected in live traffic
--slack-webhook <url>    post to a Slack incoming-webhook URL when drift is detected in live traffic
--db <path>
```

```
mcp-reliable proxy my-server -- npx my-mcp-server --flag
mcp-reliable proxy my-server --webhook https://example.com/hooks/mcp-reliable -- npx my-mcp-server
```

Unlike `monitor`'s alerts (checked on each poll), drift alerts from `proxy`
fire the moment a schema or output-shape change shows up in real traffic —
useful for catching an API contract change in production as it happens,
not at the next scheduled check. See
[`decisions/0010-alerting-notifier-design.md`](./decisions/0010-alerting-notifier-design.md).

Example agent config change (illustrative — the exact config format depends
on your client):

```jsonc
// before
{ "command": "npx", "args": ["my-mcp-server", "--flag"] }

// after
{ "command": "mcp-reliable", "args": ["proxy", "my-server", "--", "npx", "my-mcp-server", "--flag"] }
```

**Important:** this command's stdout is the live MCP protocol channel once
running. All of its own diagnostic output goes to stderr — never redirect
or merge stderr into stdout when wiring this up, or you'll corrupt the
protocol stream.

## Exit codes

Every command sets `process.exitCode = 1` on a handled error (and leaves it
`0` on success) rather than throwing past the CLI — safe to use in scripts
and CI (`mcp-reliable monitor --once && deploy.sh`, etc).
