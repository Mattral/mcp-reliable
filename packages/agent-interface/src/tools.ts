import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildRecommendation } from "@mattral/core";
import type { ReliabilityStore } from "@mattral/storage";
import { computeAgentHealthSummary } from "./health-summary.js";

const DEFAULT_WINDOW_MS = 3_600_000; // 1h, matching `monitor --window`'s default

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** Registers every mcp-reliable agent-facing tool on `server`, reading from `store`. Kept as a plain function (not a class) so it can be called once per MCP session by the CLI's `mcp` command, or reused directly by tests via InMemoryTransport. */
export function registerAgentTools(server: McpServer, store: ReliabilityStore): void {
  server.registerTool(
    "list_servers",
    {
      description:
        "List every MCP server mcp-reliable is currently tracking, with its id, name, tags, and transport type. Use the returned id with the other tools.",
      inputSchema: {}
    },
    async () => {
      const servers = store.listServers().map((s) => ({
        id: s.id,
        name: s.name,
        tags: s.tags,
        transportType: s.transport.type
      }));
      return textResult({ servers });
    }
  );

  server.registerTool(
    "get_server_health",
    {
      description:
        "Get the current reachability and tool health score for one server. Reachability reflects the most recent health check; healthScore (0-100, null if no traffic yet) reflects real tool calls observed via `mcp-reliable proxy` over the trailing window.",
      inputSchema: {
        serverId: z.string().describe("A server id from list_servers"),
        windowMs: z.number().int().positive().optional().describe("Trailing window in milliseconds (default 1h)")
      }
    },
    async ({ serverId, windowMs }) => {
      const server = store.getServer(serverId);
      if (!server) return errorResult(`No server registered with id "${serverId}".`);
      const summary = computeAgentHealthSummary(store, server, windowMs ?? DEFAULT_WINDOW_MS);
      return textResult({ serverId, ...summary });
    }
  );

  server.registerTool(
    "list_drift_events",
    {
      description:
        "List detected schema, output-shape, or statistical (e.g. latency distribution) changes for one server — a tool's contract or behavior changing out from under callers.",
      inputSchema: {
        serverId: z.string().describe("A server id from list_servers"),
        sinceMs: z.number().int().nonnegative().optional().describe("Only events at/after this epoch-ms timestamp"),
        limit: z.number().int().positive().max(500).optional()
      }
    },
    async ({ serverId, sinceMs, limit }) => {
      if (!store.getServer(serverId)) return errorResult(`No server registered with id "${serverId}".`);
      const driftEvents = store.listDriftEvents({ serverId, since: sinceMs, limit });
      return textResult({ serverId, driftEvents });
    }
  );

  server.registerTool(
    "list_alerts",
    {
      description: "List reliability alerts (unreachable, health-degradation, drift) recorded for one server.",
      inputSchema: {
        serverId: z.string().describe("A server id from list_servers"),
        onlyUnresolved: z.boolean().optional().describe("If true, only currently-open alerts")
      }
    },
    async ({ serverId, onlyUnresolved }) => {
      if (!store.getServer(serverId)) return errorResult(`No server registered with id "${serverId}".`);
      const alerts = store.listAlerts({ serverId, onlyUnresolved });
      return textResult({ serverId, alerts });
    }
  );

  server.registerTool(
    "get_recommendation",
    {
      description:
        "Get a should-I-use-this-right-now verdict (avoid/caution/healthy/unknown) for one server, synthesized from its current reachability, tool health score, and recent drift.",
      inputSchema: {
        serverId: z.string().describe("A server id from list_servers"),
        windowMs: z.number().int().positive().optional().describe("Trailing window in milliseconds (default 1h)")
      }
    },
    async ({ serverId, windowMs }) => {
      const server = store.getServer(serverId);
      if (!server) return errorResult(`No server registered with id "${serverId}".`);
      const summary = computeAgentHealthSummary(store, server, windowMs ?? DEFAULT_WINDOW_MS);
      const recommendation = buildRecommendation({
        reachable: summary.reachable,
        healthScore: summary.healthScore?.score ?? null,
        recentHighSeverityDrift: summary.recentHighSeverityDriftCount > 0
      });
      return textResult({ serverId, ...recommendation });
    }
  );

  server.registerTool(
    "list_recommendations",
    {
      description:
        "Get a should-I-use-this-right-now verdict for every tracked server in one call — the fastest way for an agent to decide which of several available MCP servers to route a task to.",
      inputSchema: {
        windowMs: z.number().int().positive().optional().describe("Trailing window in milliseconds (default 1h)")
      }
    },
    async ({ windowMs }) => {
      const servers = store.listServers();
      const recommendations = servers.map((server) => {
        const summary = computeAgentHealthSummary(store, server, windowMs ?? DEFAULT_WINDOW_MS);
        const recommendation = buildRecommendation({
          reachable: summary.reachable,
          healthScore: summary.healthScore?.score ?? null,
          recentHighSeverityDrift: summary.recentHighSeverityDriftCount > 0
        });
        return { serverId: server.id, serverName: server.name, ...recommendation };
      });
      return textResult({ recommendations });
    }
  );
}
