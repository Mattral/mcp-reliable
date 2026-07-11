# 0011 — Agent-facing MCP interface design

## Status

Accepted.

## Context

The original spec's architecture table lists a "Dual interface (Human +
Agent)" as a core design principle — "Dashboard for humans + rich MCP
interface for agents" — and names one of three target user personas as
"Agent itself... can query mcp-reliable to make better decisions about
which tools to use." The P1 feature list calls this out concretely: "Full
MCP interface: Agents can query health, drift, and recommendations."

Everything needed to answer those queries already existed in
`@mcp-reliable/core` and `@mcp-reliable/storage` — what was missing was an
MCP-shaped surface exposing it, the way `@mcp-reliable/server`'s REST API
exposes it to HTTP clients and the dashboard.

## Decisions

### A new package, not folded into `server` or `cli`

`@mcp-reliable/agent-interface` builds an `McpServer` (given a
`ReliabilityStore`) with tools registered on it, plus a
`runAgentServerOnStdio` helper. It depends only on `core` and `storage`,
matching the dependency shape of `collector` and `notifier` — every
protocol-facing package sits at the same layer, each exposing the same
underlying data through a different surface. `packages/cli`'s new `mcp`
command is a thin wrapper (`openStore` → `runAgentServerOnStdio` → close),
the same shape as `proxy.ts` and every other command file.

### stdio only, for now

Like `StdioProxyCollector` before it (see
[ADR 0003](./0003-collection-model.md)), the agent interface only ships a
stdio transport in this pass — the transport most MCP clients (Claude
Desktop, Claude Code, and most agent frameworks as of this writing)
support natively without extra configuration. An HTTP-based `/mcp`
endpoint mounted on `@mcp-reliable/server` (reusing the same
`ReliabilityStore` connection the REST API already holds) is a natural
follow-up for clients that prefer that transport, not built yet.

### Six tools, not a monolithic "query" tool

`list_servers`, `get_server_health`, `list_drift_events`, `list_alerts`,
`get_recommendation`, and `list_recommendations` — one tool per REST
resource this project already models, rather than one generic
"ask-mcp-reliable-anything" tool. This mirrors ordinary MCP tool design
practice (specific, well-typed tools an LLM can reason about from their
names and schemas) over a single free-text query surface, and keeps each
tool's Zod input schema doing real validation work.

`list_recommendations` (no `serverId` required) exists specifically for
the "which of several available servers should I route this task to"
question — the single most directly useful query for an agent choosing
between tools, and one the REST API doesn't currently have an equivalent
batch endpoint for either (it has `/api/servers/health-summary`, which
`list_recommendations` doesn't call into — see the next decision).

### Recommendations, not just raw numbers

`core`'s new `buildRecommendation` synthesizes a single `avoid | caution |
healthy | unknown` verdict (plus a one-line reason) from reachability,
health score, and recent high-severity drift — priority-ordered so
"currently unreachable" always outranks "was flaky an hour ago." This is
new logic, not a repackaging of `detectHealthDegradation`'s bands: it's
built for direct agent consumption in a single call, where
`detectHealthDegradation` is built for the monitor loop's transition
detection. See `packages/core/src/recommendations.ts` for the exact
priority order and rationale.

### The agent interface computes its own (non-persisting) health summary

`packages/agent-interface/src/health-summary.ts`'s `computeAgentHealthSummary`
duplicates the *shape* of computation `@mcp-reliable/server`'s
`/api/servers/:id/health` endpoint does, but deliberately never calls
`store.recordHealthScore`. This is not the same kind of "accept
duplication over premature abstraction" call as
[ADR 0006](./0006-server-config-duplication.md) or
[ADR 0008](./0008-dashboard-stack-and-duplication.md) — it's a genuine
behavioral difference. A human running `mcp-reliable report` is a
bounded-frequency event; an agent that queries `get_server_health` before
every tool call it considers making is not, and giving that access
pattern the same write-to-`health_scores` side effect as `report` would
change what that table (and the dashboard's history chart) actually
means.

Extracting the *shared* pure math (`redactTransport`/`serializeServer`)
from `server` into `core` in this same pass, though, **was** exactly the
"rule of three" trigger ADR 0006 describes: a third consumer needed
identical, side-effect-free logic, so it moved to the layer both could
depend on cleanly.

## A real bug found during manual testing

The first version of `runAgentServerOnStdio` was:

```ts
export async function runAgentServerOnStdio(store: ReliabilityStore): Promise<void> {
  const server = createAgentServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

`server.connect(transport)` resolves once the initial MCP handshake
completes — not when the session ends. `mcp.ts`'s `finally { store.close()
}` therefore ran immediately after a client connected, before it had a
chance to make a single tool call. Every tool call in a real end-to-end
run (a genuine MCP `Client`, connected over real stdio to a spawned
`mcp-reliable mcp` process) failed with "The database connection is not
open" — the automated test suite didn't catch this, because
`tools.test.ts` connects via `createAgentServer` + `InMemoryTransport`
directly, never going through `runAgentServerOnStdio` or the store's
lifecycle at all.

Fixed by awaiting the underlying `Server`'s `onclose` callback (exposed via
`McpServer.server`, distinct from the transport's own `onclose`, which the
SDK's `connect()` already claims internally) before returning — so the
promise this function returns doesn't resolve until the client actually
disconnects, and the store stays open for the life of the session. Verified
by re-running the exact failing reproduction (a real spawned `mcp-reliable
mcp` process, a real `Client`, real tool calls) after the fix.

Recorded here for the same reason ADR 0005 and ADR 0010 record their
respective bugs: the unit test suite's InMemoryTransport-based tests are
genuinely valuable (real protocol round trips, no mocking of MCP itself),
but they don't exercise the store's lifecycle the way a real spawned
process does — this is the second time in this project a bug only showed
up once something was actually run as a standalone process end to end
(the first being the Node 20 `.ts`-spawning issue, ADR 0009). Both are a
argument for keeping "spin it up for real and drive it with a real client"
as a standing verification step for every collector/interface package
this project adds, not just a courtesy check.

## Consequences

- `mcp-reliable mcp` is the integration point: point an agent's MCP client
  configuration at it the same way `mcp-reliable proxy` gets pointed at by
  a launch config wrapping a real server — see `docs/cli-reference.md`.
- No authentication or scoping on the agent interface — it exposes
  whatever the local `ReliabilityStore` holds, redacted the same way the
  REST API redacts transport secrets, to whatever MCP client connects to
  it. Fine for local/single-user use; revisit if this interface is ever
  exposed beyond a single machine (same caveat `SECURITY.md` already
  states for the REST API).
- `list_recommendations`/`get_recommendation` reuse
  `DEFAULT_HEALTH_DEGRADATION_THRESHOLDS` from `core`'s alerting module as
  their default bands — changing those defaults changes both what triggers
  an alert and what an agent is told to avoid, which is intentional
  (one health-score vocabulary across the whole project) but worth knowing
  if either is ever tuned independently.
