import { computeHealthScore, type HealthScore, type Server } from "@mattral/core";
import type { ReliabilityStore } from "@mattral/storage";

const HEALTH_CHECK_TOOL_NAME = "__health_check__";

export interface AgentHealthSummary {
  reachable: boolean | null;
  healthScore: HealthScore | null;
  unresolvedAlertCount: number;
  recentDriftCount: number;
  recentHighSeverityDriftCount: number;
}

/**
 * Computes reachability + a trailing-window tool health score for a
 * server, the same shape of computation `@mattral/server`'s
 * `/api/servers/:id/health` endpoint and the CLI's `report` command both
 * do — but deliberately **read-only**: it never calls
 * `store.recordHealthScore`.
 *
 * This is not the same kind of duplication `decisions/0006` and `0008`
 * accept for lack of a better option — it's an intentional behavioral
 * difference. `report` runs are human- or cron-initiated, at a bounded
 * frequency; an agent deciding "should I use this tool" might query this
 * before *every* tool call, automatically, at a frequency nothing else in
 * this project produces. Persisting a snapshot on every such read would
 * give the `health_scores` table (and the dashboard's history chart) a
 * completely different write profile than intended — see
 * `decisions/0011-agent-interface-design.md`.
 */
export function computeAgentHealthSummary(
  store: ReliabilityStore,
  server: Server,
  windowMs: number
): AgentHealthSummary {
  const windowEnd = Date.now();
  const windowStart = windowEnd - windowMs;

  const mostRecentCheck = store.listExecutions({ serverId: server.id, toolName: HEALTH_CHECK_TOOL_NAME, limit: 1 })[0];
  const reachable = mostRecentCheck ? mostRecentCheck.success : null;

  const proxyExecutions = store
    .listExecutions({ serverId: server.id, since: windowStart, until: windowEnd, limit: 10_000 })
    .filter((e) => e.source === "proxy");
  const driftEvents = store.listDriftEvents({ serverId: server.id, since: windowStart });

  const healthScore =
    proxyExecutions.length > 0
      ? computeHealthScore({ serverId: server.id, windowStart, windowEnd, executions: proxyExecutions, driftEvents })
      : null;

  const unresolvedAlertCount = store.listAlerts({ serverId: server.id, onlyUnresolved: true }).length;
  const recentDriftCount = driftEvents.length;
  const recentHighSeverityDriftCount = driftEvents.filter((e) => e.severity === "high").length;

  return { reachable, healthScore, unresolvedAlertCount, recentDriftCount, recentHighSeverityDriftCount };
}
