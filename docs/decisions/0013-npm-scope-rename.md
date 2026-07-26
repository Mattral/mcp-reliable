# 0013 — npm scope rename: `@mcp-reliable` → `@mattral`

## Status

Accepted.

## Context

[ADR 0012](./0012-v1-release-preparation.md) prepared every package to
publish under a dedicated `@mcp-reliable` npm organization. Checking
whether any of the seven *package* names were already taken on the
registry (they weren't) is a different question from whether the
*organization* name itself was available — npm reserves these
separately, and there's no way to check org-name availability from
outside npm's own UI. Attempting to actually create the org at
<https://www.npmjs.com/org/create> returned: "The organization name
'mcp-reliable' is not available" — someone or something already holds it,
unrelated to whether any code exists there.

## Decision

Publish every package under the maintainer's personal npm scope,
`@mattral`, instead of a dedicated organization scope. Personal scopes
are automatic the moment an npm account exists — no creation step, no
name to contend for, nothing left blocking the release.

This is a rename of the npm scope only. It does not touch:

- The **project name** (`mcp-reliable`, the repo, the CLI's own `bin`
  entry and unscoped published name — see
  [ADR 0012](./0012-v1-release-preparation.md)).
- Any workspace directory (`packages/core` is still `packages/core`).
- Any behavior, API, or test.

It touches every `package.json` `name` field for the seven scoped
packages, every internal `dependencies`/`devDependencies` reference
between them, every cross-package `import` statement across all six
consuming packages plus their tests, the `vitest.config.ts` aliases, and
every doc that names a package — a wide but entirely mechanical
find-and-replace of `@mcp-reliable/` → `@mattral/`, applied everywhere
except `CHANGELOG.md`'s pre-existing historical entries (see below).

## Why `CHANGELOG.md`'s past entries weren't rewritten

Every `package.json` in this repo's git history really did say
`@mcp-reliable/core` (etc.) at every commit up to this one — the rename
happened now, not retroactively. Rewriting old changelog entries to claim
the packages were always `@mattral/*` would make the changelog describe a
history that doesn't match what the repository actually looked like at
those commits. This mirrors the same reasoning applied when the CLI
package was renamed unscoped in ADR 0012: past entries describe what was
true then, and stay as written; only the current, in-flight `1.0.0` entry
(not yet actually published anywhere) gets a note about this rename,
since it's still describing pre-publish preparation, not a shipped past
state.

## Consequences

- `PUBLISHING.md`'s npm-scope section no longer presents "create an org
  or rename the scope" as an open choice — it's already made. Anyone
  reading it going forward just needs `npm login`.
- If this repository is ever transferred to a dedicated `@mcp-reliable`
  org later (e.g. if the current holder of that name releases it, or the
  project moves to a shared/team npm account), migrating scopes again
  would need: renaming every `package.json` back, a major version bump on
  every affected package (a package rename is a breaking change for
  anyone who installed the old name), and deprecation notices
  (`npm deprecate @mattral/core "moved to @mcp-reliable/core"`) pointing
  existing installs at the new name. Not needed now; worth knowing if it
  ever comes up.
- No code, tests, or behavior changed — this was verified by re-running
  the full suite (typecheck, lint, build, all 195 tests) after the rename
  and confirming zero regressions, exactly as thorough as every other
  change in this project, even though the change itself was mechanical.
