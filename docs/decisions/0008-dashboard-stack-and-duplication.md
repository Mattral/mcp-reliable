# 0008 — Dashboard stack, hash routing, and browser/Node type duplication

## Status

Accepted.

## Context

`dashboard-design.md` proposed React + Tailwind + shadcn/ui (per the
original spec's stack table), served as static assets by
`@mattral/server` with no new process. Three concrete implementation
questions came up that the design doc didn't resolve: which component
system to actually use, how client-side routing should work given the
server has no templating/fallback layer, and how (or whether) the
dashboard should reuse `@mattral/core`'s types and thresholds.

## Decisions

### 1. Hand-rolled Tailwind components, not shadcn/ui

shadcn/ui isn't an npm package — its CLI (`npx shadcn add <component>`)
copies component source from a hosted registry into your project, which
needs network access to that registry's domain. This development
environment's egress allowlist covers npm/PyPI/crates/GitHub, not
`ui.shadcn.com`, so the CLI simply couldn't run here. Independent of that
constraint, the dashboard's actual component surface (a status list, a
score readout, a chart, a couple of tables) is small enough that
hand-rolled Tailwind components are less ceremony than adopting a
component system — the same reasoning as
[ADR 0004](./0004-cli-framework-choices.md)'s Ink deviation for the CLI.

### 2. Hash-based routing (`/#/servers/:id`), not path-based

`react-router-dom`'s `createBrowserRouter` needs the server to answer
`GET /servers/xyz` with the SPA's `index.html` (a "SPA fallback" route),
since path-based routing relies on the browser's real navigation. Adding
that fallback to `@mattral/server` would mean carefully ordering it
*after* every `/api/*` route and *after* real static asset lookups, without
accidentally swallowing a genuine 404 for a missing asset.

`HashRouter` sidesteps this entirely: the URL fragment after `#` is never
sent to the server as part of the request path, so every request the
server actually sees is either `/` or a real file under
`packages/dashboard/dist`. `packages/server/src/static.ts`'s `mountDashboard`
needed no fallback logic as a result — see its tests.

Tradeoff: hash URLs are slightly less clean than path-based ones, and
history navigation nuances differ slightly. Neither matters much for an
internal ops dashboard; if this is ever revisited (e.g. for shareable
deep links that need to look clean externally), switching to
`createBrowserRouter` plus a proper fallback route in `static.ts` is a
contained, well-scoped change.

### 3. Duplicated types and thresholds, not a shared browser-safe package

`@mattral/core`'s `index.ts` re-exports `fingerprint.ts`, which
imports `node:crypto` — a Node builtin unavailable in a browser bundle.
Importing `@mattral/core` into the dashboard as-is would either fail
to bundle or require a bundler-side Node-builtin shim, neither of which is
worth it for what the dashboard actually needs: a handful of type shapes
(`Server`, `Execution`, `HealthScore`, etc.) and the score/severity color
thresholds.

Rather than splitting `core` into browser-safe/Node-only entry points (a
real option, just more work than this project's current size justifies),
the dashboard declares its own mirrored types
(`packages/dashboard/src/lib/types.ts`) and its own copy of the color
thresholds (`packages/dashboard/src/lib/format.ts`, matching
`packages/cli/src/format.ts`'s bands exactly, tested in
`packages/dashboard/test/format.test.ts` to catch drift between the two).
This extends the precedent set by
[ADR 0006](./0006-server-config-duplication.md) (accept small, documented
duplication over premature abstraction) to a second case.

## Consequences

- If `core` ever needs a genuine browser-safe subset (e.g. the dashboard
  starts needing `computeHealthScore` client-side, not just its
  thresholds), that's the trigger to add a `@mattral/core/browser`
  (or similar) subpath export containing only the Node-independent modules
  (`health-score.ts`, `stats.ts`, `drift.ts` — none of which touch
  `node:crypto`), rather than duplicating more logic by hand.
- Any change to the score/severity thresholds in
  `packages/cli/src/format.ts` must be mirrored in
  `packages/dashboard/src/lib/format.ts` by hand today; both have test
  suites asserting the exact band boundaries, so a mismatch would show up
  as a failing test in whichever package wasn't updated, not as a silent
  divergence.
- Deep-linking to a specific server (`/#/servers/my-server`) works today
  and survives a page reload (the browser still sends the initial `GET /`
  and JS reads the fragment client-side), but does not look like a
  "normal" URL to someone unfamiliar with hash routing — an accepted
  tradeoff for an internal tool per the reasoning above.
