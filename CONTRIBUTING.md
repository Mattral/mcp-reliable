# Contributing

## Setup

```bash
npm install
npm run build      # tsc -b across every package (project references enforce build order)
npm test           # vitest run — does not require the build step first, see docs/testing.md
npm run lint
```

## Before opening a PR

- `npm run lint && npm run build && npm test` should all be clean.
- New logic in `@mattral/core` (health scoring, drift detection,
  fingerprinting) should ship with unit tests covering the interesting
  boundary cases (zero samples, 100%/0% success, threshold edges) — this
  project's own [health-score formula](./docs/decisions/0005-health-score-formula.md)
  had a real design bug caught by exactly this kind of test during initial
  development, which is the whole point of keeping `core` pure and
  independently testable (see
  [ADR 0001](./docs/decisions/0001-monorepo-and-package-boundaries.md)).
- New collector behavior (`HealthChecker`, `StdioProxyCollector`) should be
  tested against the real `examples/reference-mcp-server`, not a mocked
  MCP client/server — see
  [docs/testing.md](./docs/testing.md#why-integration-tests-spawn-a-real-process)
  for why.
- Update [`docs/roadmap.md`](./docs/roadmap.md) if you finish or start a
  feature listed there, and add an ADR under `docs/decisions/` for any
  decision a future contributor would otherwise have to reverse-engineer
  from the diff.

## Code style

- TypeScript, strict mode, ESM (`NodeNext` module resolution) throughout.
- Prettier (`npm run format`) and the flat ESLint config
  (`eslint.config.js`) are the source of truth for formatting/lint rules —
  don't hand-debate style in review that a formatter should settle.
- Prefer exporting pure functions from command modules (see any file under
  `packages/cli/src/commands/`) over embedding logic directly in
  Commander `.action()` callbacks, so it stays unit-testable without
  spawning a process.

## Reporting issues

Please include: your Node.js version, the exact command you ran, and — for
anything collector-related — whether the target server uses `stdio`,
`sse`, or `http` transport (only `stdio` is supported by the traffic-
observing proxy today; see
[docs/roadmap.md](./docs/roadmap.md)).
