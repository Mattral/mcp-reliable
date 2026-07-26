import { existsSync } from "node:fs";
import path from "node:path";
import type { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";

/**
 * Two possible locations for the built dashboard, checked in order:
 *
 * 1. `dashboard-dist/` bundled into this package itself — what a
 *    standalone `npm install @mattral/server` (outside this
 *    monorepo) actually has, copied in at publish time by
 *    `scripts/copy-dashboard.mjs` (see that file's comment, and
 *    `docs/decisions/0012-v1-release-preparation.md`). Without this, a
 *    published install's dashboard would silently never be found — npm
 *    does not preserve monorepo sibling directories.
 * 2. The sibling `packages/dashboard/dist` — only present inside this
 *    monorepo, for local development without needing a publish step
 *    first.
 *
 * `packageDir` is the directory containing this package's own
 * `package.json` (i.e. `packages/server`) — passed in rather than
 * computed here so this stays a pure, easily-testable function; the real
 * entrypoint (`index.ts`) computes it from `import.meta.url`.
 */
export function resolveDashboardDist(packageDir: string): string {
  const bundled = path.resolve(packageDir, "dashboard-dist");
  if (existsSync(bundled)) return bundled;
  return path.resolve(packageDir, "..", "dashboard", "dist");
}

/**
 * Mounts the built dashboard as static assets on `app`, if it's been
 * built. Returns whether it was mounted, so the standalone entrypoint can
 * log a clear message either way rather than silently 404ing on "/"
 * forever if someone forgot to build the dashboard first.
 *
 * The dashboard is a hash-routed SPA (see `packages/dashboard/src/App.tsx`),
 * so no server-side fallback route is needed for client-side sub-routes —
 * every request this middleware sees is either a real static asset or "/"
 * itself; `/api/*` routes are registered separately in `app.ts` and take
 * precedence since Hono matches routes in registration order.
 */
export function mountDashboard(app: Hono, distDir: string): boolean {
  if (!existsSync(path.join(distDir, "index.html"))) {
    return false;
  }
  app.use("/*", serveStatic({ root: distDir }));
  return true;
}
