# 0009 — The reference MCP server must be built, not run from source, when spawned as a process

## Status

Accepted. Corrects an assumption made in the initial implementation (see
"What broke" below) — recorded as its own ADR rather than folded silently
into the code fix, for the same reason ADR 0005 documents a formula bug:
the mistake and the fix are both worth a future contributor being able to
find.

## Context

`examples/reference-mcp-server` is used two ways: `import`ed nowhere (it
has no consumers within the monorepo) and **spawned as a real OS process**
by the collector's integration tests (`HealthChecker`, `StdioProxyCollector`)
and by every CLI/getting-started example that uses it as a demo target.

The initial implementation took advantage of Node's built-in TypeScript
type-stripping (unflagged since Node 22.6) to spawn `src/index.ts`
directly with `node <path>`, specifically to avoid a build step in the
test suite and in the getting-started walkthrough. `docs/testing.md` and a
comment in the reference server's own source both documented this as
intentional.

## What broke

This project's own `package.json` declares `"engines": { "node": ">=20.0.0" }`,
and its own CI matrix (`.github/workflows/ci.yml`) tests both `20.x` and
`22.x` — but Node 20 has no TypeScript type-stripping support at all. CI
on Node 20 failed with:

```
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts" for
.../examples/reference-mcp-server/src/index.ts
```

Every collector integration test that spawned the reference server failed
— the proxy tests timed out waiting for a handshake with a process that
had already crashed on startup; the health-checker tests didn't time out
(the child process failing to start is itself a valid, `HealthChecker`-
handleable outcome) but incorrectly reported the server as unreachable
with zero tools, since the connection never actually succeeded.

This wasn't only a test-suite bug: the same crash would hit any real user
on Node 20 following `docs/getting-started.md`'s instructions, or running
`npm start` in `examples/reference-mcp-server` directly, or using its `bin`
entry — all three pointed at `src/index.ts` the same way.

## Decision

Everywhere the reference server is launched as a process — the CLI
examples in `README.md` and `docs/getting-started.md`, the package's own
`bin`/`start` entries, and the collector's integration tests — now points
at the **built** `dist/index.js`, matching how every other package in this
repo is actually run (the CLI and server packages were never run from
`src/` directly; the reference server was the sole, deliberate exception,
and it was the wrong call once Node 20 compatibility is a real
requirement, not just a stated one).

For the test suite specifically, a shared helper
(`packages/collector/test/helpers/ensure-reference-server-built.ts`) builds
the reference server once, lazily, the first time a collector test needs
it (via `tsc -b`, invoked directly rather than through `npx` for
cross-platform reliability — this matters since the project is developed
partly on Windows). This preserves the "`npm test` needs no prior manual
build" property documented in `testing.md` for every *other* package
(true because their cross-package imports are aliased to source in
`vitest.config.ts`) while fixing the one case that genuinely can't use
that trick, since a spawned process is never `import`ed.

The reference server's source file keeps its self-imposed syntax
restriction (no constructor parameter properties, enums, or namespaces) —
it costs nothing for a 3-tool demo server, and it means the file remains
directly runnable via `node src/index.ts` too, for anyone on Node 22.6+
who wants to skip the build step for quick manual testing. But nothing in
the project's own tooling, scripts, or documentation relies on that
anymore.

## Consequences

- The first collector integration test that runs in a given `vitest`
  process now takes a few seconds longer (one `tsc -b` invocation); every
  subsequent test in the same run is effectively free (in-memory memoized
  flag, and `tsc -b` itself no-ops quickly via its incremental build info
  even across separate processes/workers).
- Anyone manually trying the reference server now needs
  `examples/reference-mcp-server`'s own `npm run build` (or the root
  `npm run build`, which covers it) before `npm start` or its `bin` entry
  works — already true of every other package, and already the stated
  prerequisite in `docs/getting-started.md`.
- The broader lesson: this project declares Node 20+ support in three
  places (`package.json` engines, the CI matrix, and the original spec's
  own stack table) — any future use of a Node-version-gated runtime
  feature needs to be checked against the *oldest* declared-supported
  version, not just whatever version happens to be running in whatever
  environment a change was written and tested in.
