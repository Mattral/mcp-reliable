import { Hono } from "hono";
import { computeHealthScore } from "@mcp-reliable/core";
import type { ReliabilityStore } from "@mcp-reliable/storage";
import { serializeServer } from "./serialize.js";

const DEFAULT_WINDOW_MS = 24 * 3_600_000;
const HEALTH_CHECK_TOOL_NAME = "__health_check__";

function parseIntParam(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Builds the mcp-reliable REST API as a standalone Hono app, decoupled from
 * any particular HTTP server binding — this is what the web dashboard (next
 * milestone, see docs/roadmap.md) and, eventually, the agent-facing MCP
 * interface (P1) will both sit on top of. Kept dependency-injected on
 * `store` so it's trivially testable via `app.request(...)` without binding
 * a real port.
 */
export function createApp(store: ReliabilityStore): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  app.get("/api/servers", (c) => {
    const servers = store.listServers().map(serializeServer);
    return c.json({ servers });
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
    const windowEnd = Date.now();
    const windowStart = windowEnd - windowMs;

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

    const proxyExecutions = store
      .listExecutions({ serverId: id, since: windowStart, until: windowEnd, limit: 10_000 })
      .filter((e) => e.source === "proxy");
    const driftEvents = store.listDriftEvents({ serverId: id, since: windowStart });

    const healthScore =
      proxyExecutions.length > 0
        ? computeHealthScore({ serverId: id, windowStart, windowEnd, executions: proxyExecutions, driftEvents })
        : null;

    return c.json({ windowStart, windowEnd, reachabilityRate, healthScore });
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
