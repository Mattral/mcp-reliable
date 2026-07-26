#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { serve } from "@hono/node-server";
import { SqliteStore } from "@mattral/storage";
import { createApp } from "./app.js";
import { mountDashboard, resolveDashboardDist } from "./static.js";

/**
 * Resolves the SQLite database path the same way the CLI does (see
 * packages/cli/src/config.ts). Duplicated rather than imported so this
 * package never depends on the `mcp-reliable` CLI package — a small, deliberate
 * duplication tracked in docs/decisions/0006-server-config-duplication.md.
 */
function resolveDbPath(): string {
  if (process.env.MCP_RELIABLE_DB) return path.resolve(process.env.MCP_RELIABLE_DB);
  return path.resolve(process.cwd(), ".mcp-reliable", "data.sqlite");
}

const dbPath = resolveDbPath();
const dir = path.dirname(dbPath);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const store = new SqliteStore({ path: dbPath });
const app = createApp(store);

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dashboardMounted = mountDashboard(app, resolveDashboardDist(packageDir));

const port = process.env.MCP_RELIABLE_PORT ? Number(process.env.MCP_RELIABLE_PORT) : 4317;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`mcp-reliable server listening on http://localhost:${info.port} (db: ${dbPath})`);
  if (dashboardMounted) {
    console.log(`Dashboard: http://localhost:${info.port}/`);
  } else {
    console.log(
      `Dashboard not built yet — REST API only. Run "npm run build" in packages/dashboard, then restart.`
    );
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    store.close();
    process.exit(0);
  });
}
