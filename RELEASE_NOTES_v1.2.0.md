# mcp-reliable v1.2.0

A maintenance release: every known dependency advisory resolved, and v1
formally declared feature-complete. No new features.

## Install / upgrade

```bash
npm install -g mcp-reliable@1.2.0
```

Or, if you're already on 1.x: `npm update -g mcp-reliable`.

## What's changed

**`npm audit` is clean.** From 20 findings (4 critical, 9 high) across
runtime and dev dependencies to 0. Three targeted upgrades rather than a
blanket `npm audit fix --force`:

- `@modelcontextprotocol/sdk` minimum raised to `^1.32.2` — the version
  previously resolved had its own high-severity advisory, and its HTTP
  stack carried most of the runtime findings.
- `zod` 3 → 4. The memory-exhaustion advisory `GHSA-mrhx-c7xc-m3w5` has
  no 3.x fix, and the agent interface validates agent-supplied tool input
  with zod.
- `vitest` 2 → 4 (dev only). 4.x rather than 5.x so Node 20 stays
  supported.

Full reasoning in
[`docs/testing.md#dependency-audit-status`](./docs/testing.md#dependency-audit-status).

**Compatibility note.** `@mattral/core`'s exported data-model schemas
(`ServerSchema`, `TransportConfigSchema`, …) are now zod 4 schemas. Their
TypeScript types and `.parse()` behavior are unchanged. If you embed them
inside your own zod 3 schemas, upgrade to zod 4 too — that's the reason
this is 1.2.0 and not 1.1.1.

**The `v1.0.0` git tag is fixed.** It now points at the commit actually
published to npm as 1.0.0. The full story — including why the original
diagnosis was only half right — is in the "Resolution" section of
[`docs/decisions/0014-post-1.0-hardening-pass.md`](./docs/decisions/0014-post-1.0-hardening-pass.md).

**Docs brought back in line with the code** — README, roadmap,
`SECURITY.md`, architecture and testing docs, and `PUBLISHING.md`'s tag
check.

## Project status: feature-complete for v1

[`docs/decisions/0017-v1-scope-closure.md`](./docs/decisions/0017-v1-scope-closure.md)
records what's out of scope, why, and what would reopen it. In short:
SSE/HTTP traffic proxying, output-value drift, token tracking, and the P2
"advanced capabilities" are not planned without a concrete use case
behind them. Dependency advisories and bug reports will still be handled.

## Verified

`npm run lint`, `npm run typecheck`, `npm run build`, and all 256 tests
pass, installed with `npm ci` exactly as CI does, on Node 20 and 22.

## Thanks

Built by [Min Htet Myet (Mattral)](https://github.com/Mattral). MIT
licensed — see [`LICENSE`](./LICENSE). Issues and contributions welcome;
see [`CONTRIBUTING.md`](./CONTRIBUTING.md).
