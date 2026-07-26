import type { Alert, DriftEvent, Execution, HealthScore, Server, Tool } from "@mattral/core";

export interface ListExecutionsQuery {
  serverId: string;
  toolName?: string;
  since?: number;
  until?: number;
  /** Defaults to 500. */
  limit?: number;
}

export interface ListDriftEventsQuery {
  serverId: string;
  since?: number;
  limit?: number;
}

export interface ListAlertsQuery {
  serverId: string;
  onlyUnresolved?: boolean;
  limit?: number;
}

/**
 * Storage-agnostic persistence contract for mcp-reliable's core entities.
 *
 * `SqliteStore` is the only implementation today (see
 * docs/decisions/0002-storage-engine.md). This interface exists so a future
 * PostgreSQL-backed store (mentioned as an option in the original spec) can
 * be swapped in for multi-tenant / high-scale deployments without touching
 * the collector, CLI, or server packages.
 */
export interface ReliabilityStore {
  upsertServer(server: Server): void;
  getServer(id: string): Server | undefined;
  listServers(): Server[];
  deleteServer(id: string): void;

  /** Insert or update a tool's latest observed metadata (schema fingerprint, etc). */
  upsertTool(tool: Tool): void;
  getTool(serverId: string, toolName: string): Tool | undefined;
  listTools(serverId: string): Tool[];

  recordExecution(execution: Execution): void;
  listExecutions(query: ListExecutionsQuery): Execution[];

  recordDriftEvent(event: DriftEvent): void;
  listDriftEvents(query: ListDriftEventsQuery): DriftEvent[];

  recordHealthScore(score: HealthScore): void;
  listHealthScores(serverId: string, since?: number): HealthScore[];

  recordAlert(alert: Alert): void;
  listAlerts(query: ListAlertsQuery): Alert[];
  resolveAlert(id: string, resolvedAt: number): void;

  close(): void;
}
