import { Hono } from "hono";
import { computeHealthScore, serializeServer, type HealthScore, type Server } from "@mattral/core";
import type { ReliabilityStore } from "@mattral/storage";

const DEFAULT_WINDOW_MS = 24 * 3_600_000;
const HEALTH_CHECK_TOOL_NAME = "__health_check__";

function parseIntParam(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface ServerHealthSummary {
  server: Server;
  windowStart: number;
  windowEnd: number;
  reachabilityRate: number | null;
  /** The single most recent health check, for a "right now" status indicator distinct from the windowed reachabilityRate. */
  lastHealthCheck: { success: boolean; at: number } | null;
  healthScore: HealthScore | null;
  unresolvedAlertCount: number;
  recentDriftCount: number;
}

/**
 * Computes everything the fleet overview and server-detail dashboard views
 * need for one server in one pass: reachability + tool health score (kept
 * separate — see data-model.md#health-vs-reachability), plus counts of
 * unresolved alerts and drift events in the window, so a status list can
 * render a "needs attention" badge without a second round trip per server.
 */
function buildHealthSummary(store: ReliabilityStore, server: Server, windowMs: number): ServerHealthSummary {
  const windowEnd = Date.now();
  const windowStart = windowEnd - windowMs;
  const id = server.id;

  const healthCheckExecutions = store.listExecutions({
    serverId: id,
    toolName: HEALTH_CHECK_TOOL_NAME,
    since: windowStart,
    until: windowEnd
  });
  const reachabilityRate =
    healthCheckExecutions.length > 0
      ? healthCheckExecutions.filter((e) => e.success).length / healthCheckExecutions.length
      : null;

  // listExecutions returns most-recent-first, so [0] is the latest check
  // regardless of whether it falls inside the reachabilityRate window above.
  const mostRecentCheck = store.listExecutions({ serverId: id, toolName: HEALTH_CHECK_TOOL_NAME, limit: 1 })[0];
  const lastHealthCheck = mostRecentCheck ? { success: mostRecentCheck.success, at: mostRecentCheck.startedAt } : null;

  const proxyExecutions = store
    .listExecutions({ serverId: id, since: windowStart, until: windowEnd, limit: 10_000 })
    .filter((e) => e.source === "proxy");
  const driftEvents = store.listDriftEvents({ serverId: id, since: windowStart });

  const healthScore =
    proxyExecutions.length > 0
      ? computeHealthScore({ serverId: id, windowStart, windowEnd, executions: proxyExecutions, driftEvents })
      : null;

  const unresolvedAlertCount = store.listAlerts({ serverId: id, onlyUnresolved: true }).length;

  return {
    server,
    windowStart,
    windowEnd,
    reachabilityRate,
    lastHealthCheck,
    healthScore,
    unresolvedAlertCount,
    recentDriftCount: driftEvents.length
  };
}

/**
 * Builds the mcp-reliable REST API as a standalone Hono app, decoupled from
 * any particular HTTP server binding — this is what the web dashboard and,
 * eventually, the agent-facing MCP interface (P1) both sit on top of. Kept
 * dependency-injected on `store` so it's trivially testable via
 * `app.request(...)` without binding a real port.
 */
export function createApp(store: ReliabilityStore): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  app.get("/api/servers", (c) => {
    const servers = store.listServers().map(serializeServer);
    return c.json({ servers });
  });

  // Must be registered before /api/servers/:id so "health-summary" isn't
  // swallowed by the :id param route.
  app.get("/api/servers/health-summary", (c) => {
    const windowMs = parseIntParam(c.req.query("windowMs"), DEFAULT_WINDOW_MS);
    const summaries = store.listServers().map((server) => {
      const summary = buildHealthSummary(store, server, windowMs);
      return { ...summary, server: serializeServer(summary.server) };
    });
    return c.json({ servers: summaries });
  });

  app.get("/api/servers/:id", (c) => {
    const server = store.getServer(c.req.param("id"));
    if (!server) return c.json({ error: "server not found" }, 404);
    return c.json({ server: serializeServer(server) });
  });

  app.get("/api/servers/:id/tools", (c) => {
    const id = c.req.param("id");
    if (!store.getServer(id)) return c.json({ error: "server not found" }, 404);
    return c.json({ tools: store.listTools(id) });
  });

  app.get("/api/servers/:id/health", (c) => {
    const id = c.req.param("id");
    const server = store.getServer(id);
    if (!server) return c.json({ error: "server not found" }, 404);

    const windowMs = parseIntParam(c.req.query("windowMs"), DEFAULT_WINDOW_MS);
    const summary = buildHealthSummary(store, server, windowMs);
    const { windowStart, windowEnd, reachabilityRate, lastHealthCheck, healthScore, unresolvedAlertCount, recentDriftCount } =
      summary;
    return c.json({
      windowStart,
      windowEnd,
      reachabilityRate,
      lastHealthCheck,
      healthScore,
      unresolvedAlertCount,
      recentDriftCount
    });
  });

  app.get("/api/servers/:id/health-history", (c) => {
    const id = c.req.param("id");
    if (!store.getServer(id)) return c.json({ error: "server not found" }, 404);
    const since = c.req.query("sinceMs") ? Number(c.req.query("sinceMs")) : undefined;
    return c.json({ scores: store.listHealthScores(id, since) });
  });

  app.get("/api/servers/:id/executions", (c) => {
    const id = c.req.param("id");
    if (!store.getServer(id)) return c.json({ error: "server not found" }, 404);
    const executions = store.listExecutions({
      serverId: id,
      toolName: c.req.query("tool"),
      since: c.req.query("sinceMs") ? Number(c.req.query("sinceMs")) : undefined,
      until: c.req.query("untilMs") ? Number(c.req.query("untilMs")) : undefined,
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined
    });
    return c.json({ executions });
  });

  app.get("/api/servers/:id/drift", (c) => {
    const id = c.req.param("id");
    if (!store.getServer(id)) return c.json({ error: "server not found" }, 404);
    const since = c.req.query("sinceMs") ? Number(c.req.query("sinceMs")) : undefined;
    return c.json({ driftEvents: store.listDriftEvents({ serverId: id, since }) });
  });

  app.get("/api/servers/:id/alerts", (c) => {
    const id = c.req.param("id");
    if (!store.getServer(id)) return c.json({ error: "server not found" }, 404);
    const onlyUnresolved = c.req.query("onlyUnresolved") === "true";
    return c.json({ alerts: store.listAlerts({ serverId: id, onlyUnresolved }) });
  });

  return app;
}

