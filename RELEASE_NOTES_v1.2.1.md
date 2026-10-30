# mcp-reliable v1.2.1

A packaging-fix release. **This is the release to install for everything
described in [the 1.2.0 notes](./RELEASE_NOTES_v1.2.0.md)** — the code is
identical; only the packaging changed.

## Install / upgrade

```bash
npm install -g mcp-reliable@1.2.1
```

Or, if you're already on 1.x: `npm update -g mcp-reliable`.

## What happened to 1.2.0

The 1.2.0 publish was run from a fresh clone with no dependencies
installed and nothing built. Five packages — `@mattral/core`, `storage`,
`collector`, `notifier`, and `agent-interface` — went to npm containing
only `README.md` and `package.json`, with no `dist/` code. `@mattral/server`
and `mcp-reliable` (the CLI) stopped before publishing, so neither ever
existed at 1.2.0.

Within minutes, `latest` was moved back to 1.1.0 for all five, so nothing
installed the empty versions by default. npm doesn't allow unpublishing
packages that other published packages depend on, so the five empty
1.2.0 versions are deprecated instead. If you pinned any `@mattral/*`
package to exactly `1.2.0`, move to `1.2.1`.

## What changed

- **Every published package builds itself before publishing.** Each one
  now has a `prepublishOnly` step that runs its build. `@mattral/server`'s
  existing step builds before copying the dashboard. If dependencies
  aren't installed, the publish now fails instead of shipping an empty
  package.
- **`npm run release:publish` runs `release:check` first**, so lint,
  typecheck, build, and the full test suite must pass before anything is
  published.
- **Internal dependency ranges raised from `^1.0.0` to `^1.2.1`**, so the
  1.2.x packages never resolve one another to an empty 1.2.0, and always
  pair with siblings on the same zod 4 schemas.
- `PUBLISHING.md` now starts from a fresh `npm ci` and explains this
  incident.

## Verified

`npm run release:check` (lint, typecheck, build, all 256 tests) passes
after `npm ci`. A `npm publish --dry-run` of all seven packages shows the
same tarball contents as 1.1.0 (e.g. `@mattral/core` 42 files,
`@mattral/server` 20 files including the bundled dashboard).

## Thanks

Built by [Min Htet Myet (Mattral)](https://github.com/Mattral). MIT
licensed — see [`LICENSE`](./LICENSE). Issues and contributions welcome;
see [`CONTRIBUTING.md`](./CONTRIBUTING.md).
