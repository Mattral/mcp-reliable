import Database from "better-sqlite3";
import type { Alert, DriftEvent, Execution, HealthScore, Server, Tool } from "@mattral/core";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";
import type {
  ListAlertsQuery,
  ListDriftEventsQuery,
  ListExecutionsQuery,
  ReliabilityStore
} from "./store.js";

type ServerRow = {
  id: string;
  name: string;
  transport_json: string;
  tags_json: string;
  created_at: number;
  health_check_interval_ms: number;
};

type ToolRow = {
  id: string;
  server_id: string;
  name: string;
  description: string | null;
  schema_fingerprint: string;
  input_schema_json: string | null;
  first_seen_at: number;
  last_seen_at: number;
};

type ExecutionRow = {
  id: string;
  server_id: string;
  tool_name: string;
  started_at: number;
  duration_ms: number;
  success: number;
  error_message: string | null;
  output_signature: string | null;
  input_bytes: number | null;
  output_bytes: number | null;
  source: string;
};

type DriftEventRow = {
  id: string;
  server_id: string;
  tool_name: string;
  detected_at: number;
  kind: string;
  metric: string | null;
  severity: string;
  description: string;
  previous_value: string | null;
  new_value: string | null;
};

type AlertRow = {
  id: string;
  server_id: string;
  triggered_at: number;
  severity: string;
  kind: string;
  message: string;
  resolved_at: number | null;
};

function serverFromRow(row: ServerRow): Server {
  return {
    id: row.id,
    name: row.name,
    transport: JSON.parse(row.transport_json),
    tags: JSON.parse(row.tags_json),
    createdAt: row.created_at,
    healthCheckIntervalMs: row.health_check_interval_ms
  };
}

function toolFromRow(row: ToolRow): Tool {
  return {
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    description: row.description ?? undefined,
    schemaFingerprint: row.schema_fingerprint,
    inputSchema: row.input_schema_json ? JSON.parse(row.input_schema_json) : undefined,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at
  };
}

function executionFromRow(row: ExecutionRow): Execution {
  return {
    id: row.id,
    serverId: row.server_id,
    toolName: row.tool_name,
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    success: row.success === 1,
    errorMessage: row.error_message ?? undefined,
    outputSignature: row.output_signature ?? undefined,
    inputBytes: row.input_bytes ?? undefined,
    outputBytes: row.output_bytes ?? undefined,
    source: row.source as Execution["source"]
  };
}

function driftEventFromRow(row: DriftEventRow): DriftEvent {
  return {
    id: row.id,
    serverId: row.server_id,
    toolName: row.tool_name,
    detectedAt: row.detected_at,
    kind: row.kind as DriftEvent["kind"],
    metric: (row.metric ?? undefined) as DriftEvent["metric"],
    severity: row.severity as DriftEvent["severity"],
    description: row.description,
    previousValue: row.previous_value ?? undefined,
    newValue: row.new_value ?? undefined
  };
}

function alertFromRow(row: AlertRow): Alert {
  return {
    id: row.id,
    serverId: row.server_id,
    triggeredAt: row.triggered_at,
    severity: row.severity as Alert["severity"],
    kind: row.kind as Alert["kind"],
    message: row.message,
    resolvedAt: row.resolved_at ?? undefined
  };
}

export interface SqliteStoreOptions {
  /** Path to the SQLite file, or ':memory:' for an ephemeral in-process store (used heavily in tests). */
  path: string;
}

/**
 * Default, file-based (or in-memory) implementation of {@link ReliabilityStore},
 * backed by better-sqlite3. Chosen as the v0 default for zero-config local
 * use — see docs/decisions/0002-storage-engine.md for the full rationale
 * and what would trigger moving to PostgreSQL for a given deployment.
 */
export class SqliteStore implements ReliabilityStore {
  private readonly db: Database.Database;

  constructor(options: SqliteStoreOptions) {
    this.db = new Database(options.path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.runMigrations();
  }

  private runMigrations(): void {
    const currentVersion = this.db.pragma("user_version", { simple: true }) as number;
    if (currentVersion === 0) {
      this.db.exec(SCHEMA_SQL);
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
      return;
    }
    if (currentVersion < 2) {
      // v1 -> v2: see docs/decisions/0015-statistical-drift-detection.md.
      this.db.exec(`ALTER TABLE drift_events ADD COLUMN metric TEXT;`);
    }
    // Future schema changes: `if (currentVersion < 3) { ...ALTER TABLE...; }` etc.
    this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  upsertServer(server: Server): void {
    this.db
      .prepare(
        `INSERT INTO servers (id, name, transport_json, tags_json, created_at, health_check_interval_ms)
         VALUES (@id, @name, @transport_json, @tags_json, @created_at, @health_check_interval_ms)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           transport_json = excluded.transport_json,
           tags_json = excluded.tags_json,
           health_check_interval_ms = excluded.health_check_interval_ms`
      )
      .run({
        id: server.id,
        name: server.name,
        transport_json: JSON.stringify(server.transport),
        tags_json: JSON.stringify(server.tags),
        created_at: server.createdAt,
        health_check_interval_ms: server.healthCheckIntervalMs
      });
  }

  getServer(id: string): Server | undefined {
    const row = this.db.prepare(`SELECT * FROM servers WHERE id = ?`).get(id) as ServerRow | undefined;
    return row ? serverFromRow(row) : undefined;
  }

  listServers(): Server[] {
    const rows = this.db.prepare(`SELECT * FROM servers ORDER BY created_at ASC`).all() as ServerRow[];
    return rows.map(serverFromRow);
  }

  deleteServer(id: string): void {
    this.db.prepare(`DELETE FROM servers WHERE id = ?`).run(id);
  }

  upsertTool(tool: Tool): void {
    this.db
      .prepare(
        `INSERT INTO tools (id, server_id, name, description, schema_fingerprint, input_schema_json, first_seen_at, last_seen_at)
         VALUES (@id, @server_id, @name, @description, @schema_fingerprint, @input_schema_json, @first_seen_at, @last_seen_at)
         ON CONFLICT(server_id, name) DO UPDATE SET
           description = excluded.description,
           schema_fingerprint = excluded.schema_fingerprint,
           input_schema_json = excluded.input_schema_json,
           last_seen_at = excluded.last_seen_at`
      )
      .run({
        id: tool.id,
        server_id: tool.serverId,
        name: tool.name,
        description: tool.description ?? null,
        schema_fingerprint: tool.schemaFingerprint,
        input_schema_json: tool.inputSchema !== undefined ? JSON.stringify(tool.inputSchema) : null,
        first_seen_at: tool.firstSeenAt,
        last_seen_at: tool.lastSeenAt
      });
  }

  getTool(serverId: string, toolName: string): Tool | undefined {
    const row = this.db
      .prepare(`SELECT * FROM tools WHERE server_id = ? AND name = ?`)
      .get(serverId, toolName) as ToolRow | undefined;
    return row ? toolFromRow(row) : undefined;
  }

  listTools(serverId: string): Tool[] {
    const rows = this.db
      .prepare(`SELECT * FROM tools WHERE server_id = ? ORDER BY name ASC`)
      .all(serverId) as ToolRow[];
    return rows.map(toolFromRow);
  }

  recordExecution(execution: Execution): void {
    this.db
      .prepare(
        `INSERT INTO executions (id, server_id, tool_name, started_at, duration_ms, success, error_message, output_signature, input_bytes, output_bytes, source)
         VALUES (@id, @server_id, @tool_name, @started_at, @duration_ms, @success, @error_message, @output_signature, @input_bytes, @output_bytes, @source)`
      )
      .run({
        id: execution.id,
        server_id: execution.serverId,
        tool_name: execution.toolName,
        started_at: execution.startedAt,
        duration_ms: execution.durationMs,
        success: execution.success ? 1 : 0,
        error_message: execution.errorMessage ?? null,
        output_signature: execution.outputSignature ?? null,
        input_bytes: execution.inputBytes ?? null,
        output_bytes: execution.outputBytes ?? null,
        source: execution.source
      });
  }

  listExecutions(query: ListExecutionsQuery): Execution[] {
    const conditions = ["server_id = @server_id"];
    const params: Record<string, unknown> = { server_id: query.serverId, limit: query.limit ?? 500 };

    if (query.toolName) {
      conditions.push("tool_name = @tool_name");
      params.tool_name = query.toolName;
    }
    if (query.since !== undefined) {
      conditions.push("started_at >= @since");
      params.since = query.since;
    }
    if (query.until !== undefined) {
      conditions.push("started_at <= @until");
      params.until = query.until;
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM executions WHERE ${conditions.join(" AND ")} ORDER BY started_at DESC LIMIT @limit`
      )
      .all(params) as ExecutionRow[];
    return rows.map(executionFromRow);
  }

  recordDriftEvent(event: DriftEvent): void {
    this.db
      .prepare(
        `INSERT INTO drift_events (id, server_id, tool_name, detected_at, kind, metric, severity, description, previous_value, new_value)
         VALUES (@id, @server_id, @tool_name, @detected_at, @kind, @metric, @severity, @description, @previous_value, @new_value)`
      )
      .run({
        id: event.id,
        server_id: event.serverId,
        tool_name: event.toolName,
        detected_at: event.detectedAt,
        kind: event.kind,
        metric: event.metric ?? null,
        severity: event.severity,
        description: event.description,
        previous_value: event.previousValue ?? null,
        new_value: event.newValue ?? null
      });
  }

  listDriftEvents(query: ListDriftEventsQuery): DriftEvent[] {
    const conditions = ["server_id = @server_id"];
    const params: Record<string, unknown> = { server_id: query.serverId, limit: query.limit ?? 200 };
    if (query.since !== undefined) {
      conditions.push("detected_at >= @since");
      params.since = query.since;
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM drift_events WHERE ${conditions.join(" AND ")} ORDER BY detected_at DESC LIMIT @limit`
      )
      .all(params) as DriftEventRow[];
    return rows.map(driftEventFromRow);
  }

  recordHealthScore(score: HealthScore): void {
    this.db
      .prepare(
        `INSERT INTO health_scores (server_id, window_start, window_end, score, success_rate, p50_latency_ms, p95_latency_ms, error_rate, sample_count)
         VALUES (@server_id, @window_start, @window_end, @score, @success_rate, @p50_latency_ms, @p95_latency_ms, @error_rate, @sample_count)
         ON CONFLICT(server_id, window_start, window_end) DO UPDATE SET
           score = excluded.score,
           success_rate = excluded.success_rate,
           p50_latency_ms = excluded.p50_latency_ms,
           p95_latency_ms = excluded.p95_latency_ms,
           error_rate = excluded.error_rate,
           sample_count = excluded.sample_count`
      )
      .run({
        server_id: score.serverId,
        window_start: score.windowStart,
        window_end: score.windowEnd,
        score: score.score,
        success_rate: score.successRate,
        p50_latency_ms: score.p50LatencyMs,
        p95_latency_ms: score.p95LatencyMs,
        error_rate: score.errorRate,
        sample_count: score.sampleCount
      });
  }

  listHealthScores(serverId: string, since?: number): HealthScore[] {
    const rows =
      since !== undefined
        ? (this.db
            .prepare(
              `SELECT * FROM health_scores WHERE server_id = ? AND window_start >= ? ORDER BY window_start ASC`
            )
            .all(serverId, since) as Array<{
            server_id: string;
            window_start: number;
            window_end: number;
            score: number;
            success_rate: number;
            p50_latency_ms: number;
            p95_latency_ms: number;
            error_rate: number;
            sample_count: number;
          }>)
        : (this.db
            .prepare(`SELECT * FROM health_scores WHERE server_id = ? ORDER BY window_start ASC`)
            .all(serverId) as Array<{
            server_id: string;
            window_start: number;
            window_end: number;
            score: number;
            success_rate: number;
            p50_latency_ms: number;
            p95_latency_ms: number;
            error_rate: number;
            sample_count: number;
          }>);

    return rows.map((row) => ({
      serverId: row.server_id,
      windowStart: row.window_start,
      windowEnd: row.window_end,
      score: row.score,
      successRate: row.success_rate,
      p50LatencyMs: row.p50_latency_ms,
      p95LatencyMs: row.p95_latency_ms,
      errorRate: row.error_rate,
      sampleCount: row.sample_count
    }));
  }

  recordAlert(alert: Alert): void {
    this.db
      .prepare(
        `INSERT INTO alerts (id, server_id, triggered_at, severity, kind, message, resolved_at)
         VALUES (@id, @server_id, @triggered_at, @severity, @kind, @message, @resolved_at)`
      )
      .run({
        id: alert.id,
        server_id: alert.serverId,
        triggered_at: alert.triggeredAt,
        severity: alert.severity,
        kind: alert.kind,
        message: alert.message,
        resolved_at: alert.resolvedAt ?? null
      });
  }

  listAlerts(query: ListAlertsQuery): Alert[] {
    const conditions = ["server_id = @server_id"];
    const params: Record<string, unknown> = { server_id: query.serverId, limit: query.limit ?? 200 };
    if (query.onlyUnresolved) {
      conditions.push("resolved_at IS NULL");
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM alerts WHERE ${conditions.join(" AND ")} ORDER BY triggered_at DESC LIMIT @limit`
      )
      .all(params) as AlertRow[];
    return rows.map(alertFromRow);
  }

  resolveAlert(id: string, resolvedAt: number): void {
    this.db.prepare(`UPDATE alerts SET resolved_at = ? WHERE id = ?`).run(resolvedAt, id);
  }

  close(): void {
    this.db.close();
  }
}
