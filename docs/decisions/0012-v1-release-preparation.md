# 0012 — v1.0 release preparation

## Status

Accepted.

## Context

Every P0 item is done or intentionally partial (SSE/HTTP support in the
traffic-observing proxy), and 4 of 7 P1 items are done — a defensible
point to cut a 1.0, per the spec's own framing of P0/P1 as "Foundation"
and "Production Readiness" versus P2's "Advanced Capabilities" (see
`roadmap.md`). Calling it 1.0 meant making a few decisions that hadn't
come up yet, because nothing had been published before.

## Decisions

### Lockstep versioning across all packages

Every publishable package (`core`, `storage`, `collector`, `notifier`,
`agent-interface`, `server`, and the CLI) moves to `1.0.0` together,
rather than each package having independently tracked semver history up
to this point. This project doesn't yet have a release cadence where
packages diverge in maturity enough to justify independent versioning
(the "fixed/lockstep" mode several large monorepos use) — every package
was built in the same handful of passes, and a consumer installing
`mcp-reliable` today has no reason to think of `@mcp-reliable/core`'s
history as separate from the CLI's. Internal workspace dependency ranges
(`"@mcp-reliable/core": "^1.0.0"`, etc.) move to match.

If a package's release cadence genuinely diverges later (e.g. `core`
needs a breaking change independent of everything else), that's the
trigger to move it to independent versioning — not before.

### The CLI is published unscoped, as `mcp-reliable`

Every other package publishes as `@mcp-reliable/<name>`. The CLI does
not — it publishes as plain `mcp-reliable`, matching its own `bin` entry
and the original spec's own DX examples throughout (`npx mcp-reliable
init`, `mcp-reliable add-server ...`). A scoped package name doesn't
match what `npm install -g @mcp-reliable/cli` would actually feel like to
type versus `npm install -g mcp-reliable` — for the one package end users
actually install directly (everything else is a library dependency of
it), the friendly name wins. This is a rename of the *published* package
name only; the workspace directory stays `packages/cli` and nothing else
needed to change to accommodate it (confirmed: nothing else in this repo
imports `@mcp-reliable/cli` as a dependency — it was already a leaf in
the dependency graph, per [ADR 0001](./0001-monorepo-and-package-boundaries.md)).

### `@mcp-reliable/server` bundles the dashboard's build output before publishing

This was the one real bug caught while preparing the release, not
something anticipated in advance: `mountDashboard`'s dashboard-finding
logic (see [ADR 0008](./0008-dashboard-stack-and-duplication.md)) looked
for the built dashboard at a sibling `packages/dashboard/dist` directory —
correct inside this monorepo, but **nonexistent** for anyone who runs
`npm install @mcp-reliable/server` on its own. npm does not preserve
monorepo sibling layout on install; a standalone install would have
`mountDashboard` degrade gracefully (its own designed behavior — log that
the dashboard wasn't found, keep serving the REST API), but "gracefully
never works" is a real gap for the one deployment shape (a standalone
published install) this project hadn't actually tried until preparing to
publish for real.

Fixed with a `prepublishOnly` script
(`packages/server/scripts/copy-dashboard.mjs`) that copies the built
dashboard into the server package's own `dashboard-dist/` directory before
`npm publish` packs the tarball, and a `resolveDashboardDist` function
(`packages/server/src/static.ts`, extracted specifically so this is
independently testable rather than buried in the entrypoint) that checks
the bundled location first, falling back to the monorepo sibling for local
development. Verified by hand: built the dashboard, ran the copy script,
temporarily hid the monorepo sibling directory to simulate a standalone
install, and confirmed the server found and served the bundled copy
instead.

This is the third time in this project a bug only surfaced once something
was tried in the specific shape it would actually be used — Node 20
running the reference server as a real process (ADR 0009), a real client
killing a real proxy process (ADR 0010), and now a simulated standalone
install. Each of the three unit-testing strategies this project leans on
(vitest against source, `InMemoryTransport`, Hono's `app.request()`) is
genuinely valuable and none of them would have caught this — they don't
exercise "what does npm actually put on disk when you install this
package on its own."

### What "publish" and "release" actually mean here

Neither is something this assistant can execute on the user's behalf —
`npm publish` needs the user's own authenticated npm login (and, for the
`@mcp-reliable` scope specifically, either a free npm organization named
`mcp-reliable` or renaming the scope to an npm username the user already
controls — checked during this pass: none of the intended package names
were already taken on the registry, but scope ownership is a one-time
setup step only the user can complete), and a GitHub release needs the
user's own repository write access. See `PUBLISHING.md` for the exact,
verified sequence — dependency-order publish commands, the tag/release
steps, and the one-time scope setup decision — prepared here but run by
the user themselves, the same division of responsibility this project has
used for `git push` throughout (every commit was prepared and validated
here; every push happened on the user's machine).

## Consequences

- `dashboard-dist/` is gitignored (generated at publish time, not a
  source file) but included in `@mcp-reliable/server`'s published `files`
  list.
- Anyone building `@mcp-reliable/server` from source inside this monorepo
  (not via `npm publish`) still gets the dev-mode sibling-directory
  fallback — nothing changed about local development.
- Future packages that bundle another package's build output before
  publishing should follow this same pattern: a `prepublishOnly` script,
  an extracted-and-tested path-resolution function, and a manual
  "simulate the standalone install" verification pass before considering
  it done.
