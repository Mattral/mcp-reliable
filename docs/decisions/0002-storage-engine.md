# 0002 — Storage engine: SQLite via better-sqlite3

## Status

Accepted.

## Context

The spec's own technical stack table already names "SQLite (default),
Turso optional later" and calls out "zero friction for individuals and
small teams" as the explicit rationale. The question this ADR actually
had to resolve was *which* SQLite binding for Node, and how schema
evolution would work for a single-file v0 database.

## Decision

`better-sqlite3`, a synchronous, native-binding SQLite driver, wrapped by
`SqliteStore` behind the `ReliabilityStore` interface (`packages/storage/src/store.ts`).

Alternatives considered:

- **`node:sqlite`** (Node's built-in SQLite module) — available in the
  development environment (Node 22.22) but still experimental at time of
  writing, and the spec's own stack table targets **Node.js 20+** as the
  supported runtime for the published tool; `node:sqlite` isn't available
  there at all. Ruled out for the *shipped* package on that basis alone.
- **`sql.js`** (WASM, no native compilation) — avoids native-binding
  install friction entirely, but is meaningfully slower for the
  synchronous, high-frequency small writes this project does (one write
  per observed tool call) and requires manually persisting the in-memory
  database to disk. Not worth the tradeoff given `better-sqlite3`'s
  prebuilt binaries installed cleanly in testing with no native toolchain
  present.
- **PostgreSQL as the v0 default** — directly contradicts the spec's own
  "zero friction" principle; requires a running Postgres instance before
  `mcp-reliable init` does anything.

Schema management: a single `SCHEMA_SQL` DDL string
(`packages/storage/src/schema.ts`) applied once, gated by SQLite's built-in
`PRAGMA user_version`. There's deliberately no separate migrations
framework yet — at `SCHEMA_VERSION = 1` there's nothing to migrate *from*.
The intended pattern once the schema changes is documented directly in
`runMigrations()`: `if (currentVersion < 2) { ...ALTER TABLE...; }`,
keeping every historical migration step in one place rather than a
directory of migration files, until that stops being manageable.

## Consequences

- Zero setup: `mcp-reliable init` creates a working database file with no
  external service required, in well under the spec's "under 60 seconds"
  DX bar.
- `better-sqlite3`'s native binding means prebuilt-binary availability
  matters for install reliability on unusual platforms/architectures —
  acceptable for v0, worth monitoring as the user base grows.
- A future PostgreSQL-backed store (explicitly left as an option by the
  original spec, for "high-scale users") is a new class implementing
  `ReliabilityStore` — see ADR 0001 — not a rewrite of anything that calls
  into it.
- `journal_mode = WAL` is enabled for reasonable concurrent read/write
  behavior (a `monitor` loop reading while a `proxy` process is writing,
  for example) — this is asserted in the codebase but not yet
  load-tested; see `testing.md`'s "what's not covered yet."
