import { z } from "zod";

/**
 * Transport configuration for reaching a monitored MCP server.
 *
 * `stdio` servers are spawned as a child process; `sse` and `http` servers
 * are reached over the network. This mirrors the transports defined by the
 * MCP specification itself (see docs/architecture.md#transport-adapters).
 */
export const TransportConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().optional()
  }),
  z.object({
    type: z.literal("sse"),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional()
  }),
  z.object({
    type: z.literal("http"),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional()
  })
]);
export type TransportConfig = z.infer<typeof TransportConfigSchema>;

/** A monitored MCP server, as registered by the operator. */
export const ServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  transport: TransportConfigSchema,
  tags: z.array(z.string()).default([]),
  createdAt: z.number().int(),
  /** Milliseconds between automatic health checks in `monitor` mode. */
  healthCheckIntervalMs: z.number().int().positive().default(60_000)
});
export type Server = z.infer<typeof ServerSchema>;

/** A single tool exposed by a monitored server, as observed at some point in time. */
export const ToolSchema = z.object({
  id: z.string().min(1),
  serverId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  /** SHA-256 of the canonicalized JSON input schema. Used for schema drift detection. */
  schemaFingerprint: z.string().min(1),
  /** The raw input schema, stored for later inspection / diffing. */
  inputSchema: z.unknown(),
  firstSeenAt: z.number().int(),
  lastSeenAt: z.number().int()
});
export type Tool = z.infer<typeof ToolSchema>;

/** Outcome of a single tool invocation, as observed by a collector. */
export const ExecutionSchema = z.object({
  id: z.string().min(1),
  serverId: z.string().min(1),
  toolName: z.string().min(1),
  startedAt: z.number().int(),
  durationMs: z.number().nonnegative(),
  success: z.boolean(),
  errorMessage: z.string().optional(),
  /** Structural signature of the output (shape only, not values). Used for behavioral drift. */
  outputSignature: z.string().optional(),
  /** Best-effort size proxies; real token counts require a tokenizer and are not assumed. */
  inputBytes: z.number().int().nonnegative().optional(),
  outputBytes: z.number().int().nonnegative().optional(),
  /** Origin of this record: a live proxy pass-through, or a synthetic health-check call. */
  source: z.enum(["proxy", "health-check"]).default("proxy")
});
export type Execution = z.infer<typeof ExecutionSchema>;

/** Aggregated reliability metrics for one server over one time window. */
export const HealthScoreSchema = z.object({
  serverId: z.string().min(1),
  windowStart: z.number().int(),
  windowEnd: z.number().int(),
  /** 0-100 composite score. See docs/decisions/0005-health-score-formula.md for derivation. */
  score: z.number().min(0).max(100),
  successRate: z.number().min(0).max(1),
  p50LatencyMs: z.number().nonnegative(),
  p95LatencyMs: z.number().nonnegative(),
  errorRate: z.number().min(0).max(1),
  sampleCount: z.number().int().nonnegative()
});
export type HealthScore = z.infer<typeof HealthScoreSchema>;

export const DriftKindSchema = z.enum(["schema", "output-shape", "statistical"]);
export type DriftKind = z.infer<typeof DriftKindSchema>;

export const DriftSeveritySchema = z.enum(["low", "medium", "high"]);
export type DriftSeverity = z.infer<typeof DriftSeveritySchema>;

/**
 * Which statistic a `"statistical"` DriftEvent is about. Unlike `"schema"`
 * and `"output-shape"`, `"statistical"` isn't self-describing on its own —
 * see docs/decisions/0015-statistical-drift-detection.md. `undefined` for
 * the other two kinds.
 */
export const DriftMetricSchema = z.enum(["latency"]);
export type DriftMetric = z.infer<typeof DriftMetricSchema>;

/** A detected behavioral or structural change in a tool. */
export const DriftEventSchema = z.object({
  id: z.string().min(1),
  serverId: z.string().min(1),
  toolName: z.string().min(1),
  detectedAt: z.number().int(),
  kind: DriftKindSchema,
  /** Only present when kind === "statistical" (which statistic drifted). */
  metric: DriftMetricSchema.optional(),
  severity: DriftSeveritySchema,
  description: z.string().min(1),
  previousValue: z.string().optional(),
  newValue: z.string().optional()
});
export type DriftEvent = z.infer<typeof DriftEventSchema>;

export const AlertSeveritySchema = z.enum(["info", "warning", "critical"]);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

/** A notification-worthy reliability event for a server. */
export const AlertSchema = z.object({
  id: z.string().min(1),
  serverId: z.string().min(1),
  triggeredAt: z.number().int(),
  severity: AlertSeveritySchema,
  kind: z.enum(["health-degradation", "drift", "unreachable"]),
  message: z.string().min(1),
  resolvedAt: z.number().int().optional()
});
export type Alert = z.infer<typeof AlertSchema>;
