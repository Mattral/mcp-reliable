import { existsSync } from "node:fs";
import path from "node:path";
import type { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";

/**
 * Mounts the built dashboard (`packages/dashboard/dist`) as static assets
 * on `app`, if it's been built. Returns whether it was mounted, so the
 * standalone entrypoint can log a clear message either way rather than
 * silently 404ing on "/" forever if someone forgot to build the dashboard
 * package specifically (`npm run build` at the repo root covers it; running
 * only `packages/server`'s own build script does not).
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
