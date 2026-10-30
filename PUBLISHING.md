# Publishing & Release Guide

This is the mechanical checklist for actually shipping a release: `npm
publish` for every package, a tagged GitHub release, and release notes.
Every step needs the maintainer's own npm login and GitHub write access. Everything here has been
prepared and verified up to the point where your credentials take over
(see [`docs/decisions/0012-v1-release-preparation.md`](./docs/decisions/0012-v1-release-preparation.md)
for what "verified" means for each piece).

## 0. npm scope — already resolved, nothing to set up

Seven packages publish under the `@mattral/` scope, plus one
(`mcp-reliable` itself, the CLI) unscoped.

The original plan was a dedicated `@mcp-reliable` npm organization, but
that name was already taken when we went to create it — unrelated to
whether any code existed there; npm organization names and package names
are reserved separately. Rather than fight over an alternative org name,
every package publishes under **your personal npm scope, `@mattral`**
instead. Personal scopes are automatic the moment you have an npm
account — there is no "create an org" step for this option, unlike the
original plan. See
[`docs/decisions/0013-npm-scope-rename.md`](./docs/decisions/0013-npm-scope-rename.md)
for the full account.

Just run `npm login` if you haven't already, and confirm with `npm whoami`
that it shows `mattral`.

## 1. Pre-flight check

From the repo root, starting with a clean install, even in a checkout
you think is already set up:

```
npm ci
npm run release:check
```

This runs lint, a full typecheck, a full build, and the entire test suite
(should be 256 tests passing). Don't publish anything if this doesn't
pass clean.

**Why `npm ci` comes first:** this was skipped for the 1.2.0 release.
`release:check` failed immediately (`'eslint' is not recognized`), the
publish ran anyway from a clone with nothing built, and five packages
went to npm containing only `README.md` and `package.json`. Since 1.2.1,
every package's `prepublishOnly` runs its build, and `release:publish`
runs `release:check` itself, so the same mistake now fails instead of
publishing. See `RELEASE_NOTES_v1.2.1.md` for how it was cleaned up:
the empty versions can't be unpublished once other packages depend on
them, so they were deprecated and `latest` was moved back.

## 2. Build the dashboard before publishing the server package

`@mattral/server` bundles the dashboard's build output into itself
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

**A scary-looking but harmless warning you may see during `npm publish`
for `cli` or `server`:**

```
npm warn publish npm auto-corrected some errors in your package.json when publishing. Please run "npm pkg fix" to address these errors.
npm warn publish bin[...] script name ... was invalid and removed
```

This is a known bug in the npm CLI itself
([npm/cli#7302](https://github.com/npm/cli/issues/7302)), not a problem
with this project's `package.json` files. It showed up during the actual
`v1.0.0` publish and was confirmed harmless at the time by inspecting the
published tarball on the registry — the `bin` entry was intact and `npx
mcp-reliable` worked correctly despite the warning. Safe to ignore; don't
"fix" it by changing `bin` field syntax based on the warning alone.

Alternative, once you're comfortable with the above having worked once:
`npm run release:publish` at the root runs `release:check`, then all
seven in one command via npm's `--workspace` flag (in the order listed).
This is how 1.2.1 was published.

**If a publish goes out broken:** npm never lets you reuse a version
number, and refuses to unpublish a package that other published
packages depend on, which applies to every package here except the CLI.
Instead:

```
npm dist-tag add @mattral/<pkg>@<last-good-version> latest
npm deprecate "@mattral/<pkg>@<broken-version>" "<reason>. Use <fixed-version> or later."
```

Then bump to the next patch version and publish again.

## 4. Verify

```
npm view mcp-reliable version
npm view @mattral/core version
npm view @mattral/server version
```

Each should print the version you just published (`1.2.1` as of this
writing — check `package.json` at the repo root if it's been a while).
Then, in a scratch directory *outside* this repo (important — this is the
real test of whether a standalone install actually works, not just the
monorepo dev setup):

```bash
# macOS / Linux — replace <version> with the version you just published
mkdir -p /tmp/mcp-reliable-smoke && cd /tmp/mcp-reliable-smoke
npx mcp-reliable@<version> --version
npx mcp-reliable@<version> init
```

```powershell
# Windows PowerShell — replace <version> with the version you just published
New-Item -ItemType Directory -Force "$env:TEMP\mcp-reliable-smoke" | Out-Null
Set-Location "$env:TEMP\mcp-reliable-smoke"
npx mcp-reliable@<version> --version
npx mcp-reliable@<version> init
```

```cmd
:: Windows cmd.exe — replace <version> with the version you just published
mkdir "%TEMP%\mcp-reliable-smoke" 2>nul
cd /d "%TEMP%\mcp-reliable-smoke"
npx mcp-reliable@<version> --version
npx mcp-reliable@<version> init
```

Since this project is actually run and published from Windows day to day,
prefer the PowerShell/cmd form when
verifying a real release — the Unix form is here for anyone publishing
from a Linux/macOS machine instead.

## 5. Tag and push

```
git tag -a v<version> -m "v<version>"
git push origin v<version>
```

**Verify the tag actually points where you think it does before trusting
it** — this bit the project for real once already. If `git tag -a`
reports `"tag already exists"`, a tag was created earlier than you
expect, possibly before some later doc/rename commits. Check:

```
git log v<version> --oneline -1     # what the tag currently points to
git log HEAD --oneline -1           # what you actually want it to point to
git merge-base --is-ancestor v<version> HEAD && echo "tag is on this branch"
```

The last check matters: a tag can carry the right files and commit
message while sitting on a different line of history entirely (this is
what actually happened to `v1.0.0`).

If those differ, the tag is stale. Fix it by deleting and recreating at
the current `HEAD`, then force-pushing:

```
git tag -d v<version>
git tag -a v<version> -m "v<version>" HEAD
git push origin v<version> --force
```

(This exact scenario happened during the real `v1.0.0` release: the tag
was created before the `@mcp-reliable` → `@mattral` scope rename
finished, leaving it pointing at a commit whose `package.json` files
don't match what's actually on npm. The tag was corrected on 2026-10-30;
see ADR 0014 for the full account.)

## 6. GitHub release

`RELEASE_NOTES_v<version>.md` (repo root — create one per release,
following the existing ones' structure) is ready to use as the release
body as-is. Either:

```
gh release create v<version> --title "v<version>" --notes-file RELEASE_NOTES_v<version>.md
```

or, without the GitHub CLI: GitHub → your repo → **Releases** → **Draft a
new release** → tag `v<version>` → title `v<version>` → paste the
contents of `RELEASE_NOTES_v<version>.md` into the description →
**Publish release**.

## 7. After release

- `docs/roadmap.md` already reflects what's in this release; no changes
  needed there unless you start the next feature.
- Future releases: bump versions again (no longer necessarily in
  lockstep — see ADR 0012), update `CHANGELOG.md`, re-run this checklist
  from step 1.
