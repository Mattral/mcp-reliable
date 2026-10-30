# mcp-reliable v1.2.2

A small bug-fix release: everything now reports its real version.

## Install / upgrade

```bash
npm install -g mcp-reliable@1.2.2
```

Or, if you're already on 1.x: `npm update -g mcp-reliable`.

## Fixed

- **`mcp-reliable --version` printed `1.0.0`** in every release since
  1.0.0, because the number was written into the source. It now reads
  the CLI package's own `package.json`.
- **The agent interface** (`mcp-reliable mcp`) told MCP clients it was
  version `1.0.0`, and **the health checker** sent `1.0.0` as its client
  version to the servers it monitors. Both now report their package's
  real version.

Internal `@mattral/*` dependency ranges are raised to `^1.2.2`, so the
packages always install alongside the fixed versions of one another.

## Verified

After `npm ci`, `npm run release:check` (lint, typecheck, build, all 259
tests) passes. New tests check that each fixed package's version matches
its `package.json`, and that the agent interface reports it over a real
MCP connection.

## Thanks

Built by [Min Htet Myet (Mattral)](https://github.com/Mattral). MIT
licensed — see [`LICENSE`](./LICENSE). Issues and contributions welcome;
see [`CONTRIBUTING.md`](./CONTRIBUTING.md).
