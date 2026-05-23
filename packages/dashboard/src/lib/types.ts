/**
 * These types mirror `@mcp-reliable/core`'s data model closely enough to
 * type the REST API's JSON responses, but are declared independently
 * rather than imported from `@mcp-reliable/core` directly: that package's
 * `index.ts` re-exports `fingerprint.ts`, which imports `node:crypto` — a
 * Node builtin that doesn't exist in a browser bundle. Duplicating just the
 * type shapes (zero runtime cost) is simpler than splitting `core` into
 * browser-safe/Node-only entry points for a project this size. See
 * docs/decisions/0008-dashboard-stack-and-duplication.md.
 */

export type TransportConfig =
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  | { type: "sse"; url: string; headers?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string> };

export interface Server {
  id: string;
  name: string;
  transport: TransportConfig;
  tags: string[];
  createdAt: number;
  healthCheckIntervalMs: number;
}

export interface Tool {
  id: string;
  serverId: string;
  name: string;
  description?: string;
  schemaFingerprint: string;
  inputSchema: unknown;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface Execution {
  id: string;
  serverId: string;
  toolName: string;
  startedAt: number;
  durationMs: number;
  success: boolean;
  errorMessage?: string;
  outputSignature?: string;
  inputBytes?: number;
  outputBytes?: number;
  source: "proxy" | "health-check";
}

export interface HealthScore {
  serverId: string;
  windowStart: number;
  windowEnd: number;
  score: number;
  successRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  errorRate: number;
  sampleCount: number;
}

export type DriftKind = "schema" | "output-shape";
export type DriftSeverity = "low" | "medium" | "high";

export interface DriftEvent {
  id: string;
  serverId: string;
  toolName: string;
  detectedAt: number;
  kind: DriftKind;
  severity: DriftSeverity;
  description: string;
  previousValue?: string;
  newValue?: string;
}

export type AlertSeverity = "info" | "warning" | "critical";

export interface Alert {
  id: string;
  serverId: string;
  triggeredAt: number;
  severity: AlertSeverity;
  kind: "health-degradation" | "drift" | "unreachable";
  message: string;
  resolvedAt?: number;
}

export interface ServerHealthSummary {
  server: Server;
  windowStart: number;
  windowEnd: number;
  reachabilityRate: number | null;
  lastHealthCheck: { success: boolean; at: number } | null;
  healthScore: HealthScore | null;
  unresolvedAlertCount: number;
  recentDriftCount: number;
}
