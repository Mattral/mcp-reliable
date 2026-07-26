# 0001 — Monorepo structure and package boundaries

## Status

Accepted.

## Context

The spec calls for a platform with several distinct components (collector,
analyzer, dashboard, MCP server, alerting, reporting) sharing a data model.
These need to be independently testable and buildable in dependency order,
while staying easy to navigate as a single project during early development
where interfaces are still moving.

## Decision

A single npm-workspaces monorepo (no Lerna/Nx/Turborepo — npm's built-in
workspaces support is sufficient at this scale and adds no extra tooling
dependency), with packages split by responsibility rather than by
deployment artifact:

- `@mattral/core` — pure data model, health scoring, drift detection.
  No I/O. This boundary exists specifically so the reliability *math* can
  be unit tested without a database or network call, and so it's reusable
  by both the CLI and (later) the dashboard without either depending on
  the other.
- `@mattral/storage` — the only package that knows SQLite exists,
  behind a `ReliabilityStore` interface `core` and `collector` never see
  the concrete implementation of.
- `@mattral/collector` — depends on `core` (for fingerprinting/drift)
  and `storage` (to persist what it observes), plus the MCP SDK. This is
  the only package that talks to a monitored MCP server.
- `mcp-reliable` (the CLI, published unscoped — see
  `decisions/0012-v1-release-preparation.md`) and `@mattral/server` —
  two independent consumers of `core`/`storage`/`collector`. Neither
  depends on the other. `server` doesn't depend on the CLI even though
  they duplicate a small amount of config-resolution logic — see ADR 0006.
- `examples/reference-mcp-server` — depends on nothing from this project
  (just the MCP SDK + zod), by design: it exists to be *monitored*, not to
  monitor.

TypeScript project references (`tsc -b`) enforce the dependency order at
build time; `vitest`'s alias config (see `testing.md`) points cross-package
imports at source during tests so the inner test loop doesn't require a
prior build.

## Consequences

- No package can accidentally reach into another's internals — only what's
  exported from each package's `index.ts` is visible to consumers.
- Adding a PostgreSQL-backed store later means writing one new class that
  implements `ReliabilityStore`; nothing else changes (see ADR 0002).
- Adding the web dashboard means adding a new package (or a build step
  inside `server`) that depends on `server`'s REST API, not on `core`/
  `storage` directly — the dashboard should never need to know SQL exists.
