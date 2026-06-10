import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const referenceServerDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../examples/reference-mcp-server"
);
const distEntry = path.join(referenceServerDir, "dist", "index.js");

const require = createRequire(import.meta.url);

let built = false;

/**
 * The reference MCP server is spawned as a real, standalone OS process by
 * the collector's integration tests (`HealthChecker`, `StdioProxyCollector`)
 * — unlike every other cross-package reference in this monorepo, it can't
 * benefit from vitest's src-aliasing (see ../../../../vitest.config.ts),
 * because it's never `import`ed, only launched via `spawn(node, [path])`.
 *
 * Node's built-in TypeScript type-stripping (unflagged since Node 22.6)
 * would let a child process run straight from `src/index.ts` with no
 * build step — and that's exactly what this project did at first. It
 * broke in CI on Node 20 (`ERR_UNKNOWN_FILE_EXTENSION: .ts`), because
 * Node 20 — this project's stated minimum (see package.json `engines` and
 * the CI matrix) — has no type-stripping support at all. See
 * docs/decisions/0009-reference-server-must-be-built-for-tests.md.
 *
 * The fix: build the reference server once, lazily, the first time a test
 * needs it, and spawn the compiled output instead — the same thing every
 * other package in this repo does at runtime. Idempotent and safe to call
 * from multiple test files: `tsc -b` no-ops quickly if already current,
 * and the in-memory `built` flag skips even that within a single worker.
 */
export function ensureReferenceServerBuilt(): string {
  if (!built) {
    const tscBin = require.resolve("typescript/bin/tsc");
    execFileSync(process.execPath, [tscBin, "-b", referenceServerDir], { stdio: "inherit" });
    built = true;
  }
  if (!existsSync(distEntry)) {
    throw new Error(`Expected ${distEntry} to exist after building the reference MCP server`);
  }
  return distEntry;
}
