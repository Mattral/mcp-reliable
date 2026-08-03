/**
 * Schema version this build of @mattral/storage expects. Stored in
 * SQLite's built-in `PRAGMA user_version`. When this number is bumped,
 * `runMigrations` below should grow a `if (version < N)` branch that
 * migrates forward — there is deliberately no separate migrations table
 * for a single-file v0 schema (see docs/decisions/0002-storage-engine.md).
 *
 * v1 -> v2: `drift_events` gained a `metric` column (statistical drift
 * detection needs to say *which* statistic drifted, since unlike
 * "schema"/"output-shape" the "statistical" kind isn't self-describing —
 * see docs/decisions/0015-statistical-drift-detection.md).
 */
export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport_json TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  health_check_interval_ms INTEGER NOT NULL DEFAULT 60000
);

CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  schema_fingerprint TEXT NOT NULL,
  input_schema_json TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE (server_id, name)
);

CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  duration_ms REAL NOT NULL,
  success INTEGER NOT NULL,
  error_message TEXT,
  output_signature TEXT,
  input_bytes INTEGER,
  output_bytes INTEGER,
  source TEXT NOT NULL DEFAULT 'proxy'
);
CREATE INDEX IF NOT EXISTS idx_executions_server_time ON executions(server_id, started_at);
CREATE INDEX IF NOT EXISTS idx_executions_server_tool_time ON executions(server_id, tool_name, started_at);

CREATE TABLE IF NOT EXISTS drift_events (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  detected_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  metric TEXT,
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT
);
CREATE INDEX IF NOT EXISTS idx_drift_server_time ON drift_events(server_id, detected_at);

CREATE TABLE IF NOT EXISTS health_scores (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  window_start INTEGER NOT NULL,
  window_end INTEGER NOT NULL,
  score REAL NOT NULL,
  success_rate REAL NOT NULL,
  p50_latency_ms REAL NOT NULL,
  p95_latency_ms REAL NOT NULL,
  error_rate REAL NOT NULL,
  sample_count INTEGER NOT NULL,
  PRIMARY KEY (server_id, window_start, window_end)
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  triggered_at INTEGER NOT NULL,
  severity TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_alerts_server_time ON alerts(server_id, triggered_at);
`;
