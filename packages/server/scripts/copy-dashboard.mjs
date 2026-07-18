#!/usr/bin/env node
// Runs as `prepublishOnly` (see package.json): copies the built dashboard
// (../dashboard/dist) into this package's own dashboard-dist/ before
// `npm publish` packs the tarball.
//
// Why this exists: `mountDashboard` (../src/static.ts) is asked for a
// directory to serve, and the *dev-mode* answer — the sibling
// packages/dashboard/dist directory — only exists inside this monorepo.
// Once @mcp-reliable/server is published and `npm install`ed on its own,
// there is no sibling packages/dashboard at all; npm does not preserve
// monorepo layout. Without this step, a standalone install's dashboard
// would silently never be found (mountDashboard degrades gracefully, per
// its own design, rather than crashing — but "gracefully never works" is
// still a real gap for anyone installing the published package outside
// this repo). See docs/decisions/0012-v1-release-preparation.md.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "..", "..", "dashboard", "dist");
const dest = path.resolve(here, "..", "dashboard-dist");

if (!existsSync(source)) {
  console.error(
    `[copy-dashboard] ${source} does not exist. Build the dashboard first: (cd packages/dashboard && npm run build).`
  );
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(source, dest, { recursive: true });
console.log(`[copy-dashboard] copied ${source} -> ${dest}`);
