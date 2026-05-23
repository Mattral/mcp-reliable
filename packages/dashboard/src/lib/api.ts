import type { Alert, DriftEvent, Execution, HealthScore, Server, ServerHealthSummary, Tool } from "./types.js";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `Request to ${path} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const api = {
  listServers: () => getJson<{ servers: Server[] }>("/api/servers").then((r) => r.servers),

  healthSummary: (windowMs: number) =>
    getJson<{ servers: ServerHealthSummary[] }>(`/api/servers/health-summary?windowMs=${windowMs}`).then(
      (r) => r.servers
    ),

  getServer: (id: string) => getJson<{ server: Server }>(`/api/servers/${id}`).then((r) => r.server),

  listTools: (id: string) => getJson<{ tools: Tool[] }>(`/api/servers/${id}/tools`).then((r) => r.tools),

  getHealth: (id: string, windowMs: number) =>
    getJson<{
      windowStart: number;
      windowEnd: number;
      reachabilityRate: number | null;
      lastHealthCheck: { success: boolean; at: number } | null;
      healthScore: HealthScore | null;
      unresolvedAlertCount: number;
      recentDriftCount: number;
    }>(`/api/servers/${id}/health?windowMs=${windowMs}`),

  healthHistory: (id: string, sinceMs?: number) =>
    getJson<{ scores: HealthScore[] }>(
      `/api/servers/${id}/health-history${sinceMs ? `?sinceMs=${sinceMs}` : ""}`
    ).then((r) => r.scores),

  listExecutions: (id: string, params: { tool?: string; sinceMs?: number; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.tool) query.set("tool", params.tool);
    if (params.sinceMs) query.set("sinceMs", String(params.sinceMs));
    query.set("limit", String(params.limit ?? 100));
    return getJson<{ executions: Execution[] }>(`/api/servers/${id}/executions?${query}`).then(
      (r) => r.executions
    );
  },

  listDrift: (id: string, sinceMs?: number) =>
    getJson<{ driftEvents: DriftEvent[] }>(
      `/api/servers/${id}/drift${sinceMs ? `?sinceMs=${sinceMs}` : ""}`
    ).then((r) => r.driftEvents),

  listAlerts: (id: string, onlyUnresolved = false) =>
    getJson<{ alerts: Alert[] }>(`/api/servers/${id}/alerts${onlyUnresolved ? "?onlyUnresolved=true" : ""}`).then(
      (r) => r.alerts
    )
};
