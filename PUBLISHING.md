# Publishing & Release Guide

This is the mechanical checklist for actually shipping a release: `npm
publish` for every package, a tagged GitHub release, and release notes.
None of these steps can be run by Claude on your behalf — they need your
own npm login and your own GitHub write access. Everything here has been
prepared and verified up to the point where your credentials take over
(see [`docs/decisions/0012-v1-release-preparation.md`](./docs/decisions/0012-v1-release-preparation.md)
for what "verified" means for each piece).

## 0. One-time npm scope setup (only needed the first time you publish)

Seven packages publish under the `@mcp-reliable/` scope, plus one
(`mcp-reliable` itself, the CLI) unscoped. Publishing under a scope
requires you to control that scope on npm — pick one:

- **Create a free npm organization named `mcp-reliable`** at
  <https://www.npmjs.com/org/create> (public packages are free under an
  org; you only pay for private ones). This is the option that keeps
  every package name exactly as written in this repo.
- **Or: rename the scope** to an npm username/org you already control
  (e.g. if your npm username is `mattral`, change every
  `"@mcp-reliable/..."` name in `packages/*/package.json` — and every
  place other packages `dependencies` reference them — to
  `"@mattral/..."`). More edits, but no new org to create.

Either way, run `npm login` once if you haven't already, and confirm with
`npm whoami`.

## 1. Pre-flight check

From the repo root:

```
npm run release:check
```

This runs lint, a full typecheck, a full build, and the entire test suite
(should be 195 tests passing). Don't publish anything if this doesn't
pass clean.

## 2. Build the dashboard before publishing the server package

`@mcp-reliable/server` bundles the dashboard's build output into itself
at publish time (`prepublishOnly` runs `scripts/copy-dashboard.mjs` — see
ADR 0012 for why). `npm run build` at the root already builds the
dashboard, so if you just ran step 1, this is already done. If you're
publishing later without a fresh full build, build it explicitly first:

```
cd packages/dashboard && npm run build && cd ../..
```

## 3. Publish, in dependency order

Each command below is `npm publish` from that package's own directory.
Order matters the first time you publish (a dependent package's declared
`^1.0.0` range should resolve against something that already exists on
the registry) — after this initial release, order stops mattering as much
since versions won't jump like this again.

```
cd packages/core && npm publish && cd ../..
cd packages/storage && npm publish && cd ../..
cd packages/collector && npm publish && cd ../..
cd packages/notifier && npm publish && cd ../..
cd packages/agent-interface && npm publish && cd ../..
cd packages/server && npm publish && cd ../..
cd packages/cli && npm publish && cd ../..
```

Every package.json already sets `"publishConfig": { "access": "public" }`,
so plain `npm publish` (no `--access public` flag needed) works even
though these are scoped packages.

Alternative, once you're comfortable with the above having worked once:
`npm run release:publish` at the root runs all seven in one command via
npm's `--workspace` flag (order handled by npm's own workspace dependency
resolution — the manual sequence above is the one actually verified step
by step; this is the convenience version for next time).

## 4. Verify

```
npm view mcp-reliable version
npm view @mcp-reliable/core version
npm view @mcp-reliable/server version
```

Each should print `1.0.0`. Then, in a scratch directory *outside* this
repo (important — this is the real test of whether a standalone install
actually works, not just the monorepo dev setup):

```
mkdir /tmp/mcp-reliable-smoke && cd /tmp/mcp-reliable-smoke
npx mcp-reliable@1.0.0 --version
npx mcp-reliable@1.0.0 init
```

## 5. Tag and push

```
git tag -a v1.0.0 -m "v1.0.0"
git push origin v1.0.0
```

## 6. GitHub release

`RELEASE_NOTES_v1.0.0.md` (repo root) is ready to use as the release body
as-is. Either:

```
gh release create v1.0.0 --title "v1.0.0" --notes-file RELEASE_NOTES_v1.0.0.md
```

or, without the GitHub CLI: GitHub → your repo → **Releases** → **Draft a
new release** → tag `v1.0.0` → title `v1.0.0` → paste the contents of
`RELEASE_NOTES_v1.0.0.md` into the description → **Publish release**.

## 7. After release

- `docs/roadmap.md` already reflects what's in this release; no changes
  needed there unless you start the next feature.
- Future releases: bump versions again (no longer necessarily in
  lockstep — see ADR 0012), update `CHANGELOG.md`, re-run this checklist
  from step 1.
