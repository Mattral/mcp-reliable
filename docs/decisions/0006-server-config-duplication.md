# 0006 — Duplicated DB-path config resolution between `cli` and `server`

## Status

Accepted, revisit if a third consumer appears.

## Context

Both `@mcp-reliable/cli` and `@mcp-reliable/server` need to answer the same
small question: "where's the SQLite database?" (`--db`/`MCP_RELIABLE_DB`/
`./.mcp-reliable/data.sqlite`, in that precedence order). `packages/cli/src/config.ts`
and `packages/server/src/index.ts` each implement this independently —
about 15 lines, duplicated rather than shared.

## Decision

Accept the duplication for now rather than introducing a new shared
package (e.g. `@mcp-reliable/config`) or having `server` depend on `cli`.

Reasoning: `server` depending on `cli` would be backwards (a REST API
service depending on a command-line tool is an odd dependency direction,
and would drag CLI-only dependencies like `commander`/`chalk`/`ora` into a
package meant to be run as a lightweight service). A brand-new package for
15 lines of logic used by exactly two consumers is more ceremony than the
duplication it would remove — extra `package.json`, `tsconfig.json`, a
build step, and a version to keep in sync, for less code than this ADR.

## Consequences

- If a third package needs the same convention (a future dashboard-serving
  process, a background scheduler, etc.), that's the trigger to extract a
  shared `@mcp-reliable/config` package — "rule of three," not "rule of
  two."
- Until then, a change to the DB-path resolution convention (e.g. adding a
  config-file-based override) must be applied in both
  `packages/cli/src/config.ts` and `packages/server/src/index.ts` by hand.
  This is a known, accepted maintenance cost, not an oversight.
