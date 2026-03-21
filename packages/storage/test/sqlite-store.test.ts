import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Alert, DriftEvent, Execution, HealthScore, Server, Tool } from "@mcp-reliable/core";
import { SqliteStore } from "../src/sqlite-store.js";

function makeServer(overrides: Partial<Server> = {}): Server {
  return {
    id: overrides.id ?? randomUUID(),
    name: "test-server",
    transport: { type: "stdio", command: "npx", args: ["my-mcp-server"] },
    tags: ["test"],
    createdAt: Date.now(),
    healthCheckIntervalMs: 60_000,
    ...overrides
  };
}

describe("SqliteStore", () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore({ path: ":memory:" });
  });

  afterEach(() => {
    store.close();
  });

  it("round-trips a server, including nested transport config", () => {
    const server = makeServer();
    store.upsertServer(server);
    const fetched = store.getServer(server.id);
    expect(fetched).toEqual(server);
  });

  it("upserts a server without creating duplicates", () => {
    const server = makeServer({ name: "v1" });
    store.upsertServer(server);
    store.upsertServer({ ...server, name: "v2" });
    expect(store.listServers()).toHaveLength(1);
    expect(store.getServer(server.id)?.name).toBe("v2");
  });

  it("deletes a server and cascades to its executions", () => {
    const server = makeServer();
    store.upsertServer(server);
    store.recordExecution({
      id: randomUUID(),
      serverId: server.id,
      toolName: "search",
      startedAt: Date.now(),
      durationMs: 10,
      success: true,
      source: "proxy"
    });
    store.deleteServer(server.id);
    expect(store.getServer(server.id)).toBeUndefined();
    expect(store.listExecutions({ serverId: server.id })).toHaveLength(0);
  });

  it("round-trips a tool and enforces one row per (server, name)", () => {
    const server = makeServer();
    store.upsertServer(server);
    const tool: Tool = {
      id: randomUUID(),
      serverId: server.id,
      name: "search",
      description: "Search the web",
      schemaFingerprint: "fp-1",
      inputSchema: { type: "object", properties: { q: { type: "string" } } },
      firstSeenAt: 1000,
      lastSeenAt: 1000
    };
    store.upsertTool(tool);
    store.upsertTool({ ...tool, schemaFingerprint: "fp-2", lastSeenAt: 2000 });

    const fetched = store.getTool(server.id, "search");
    expect(fetched?.schemaFingerprint).toBe("fp-2");
    expect(fetched?.lastSeenAt).toBe(2000);
    expect(fetched?.firstSeenAt).toBe(1000); // first_seen_at is set on insert and never overwritten by upsert
    expect(store.listTools(server.id)).toHaveLength(1);
  });

  it("records and lists executions filtered by tool name and time range", () => {
    const server = makeServer();
    store.upsertServer(server);

    const base = 10_000;
    const executions: Execution[] = [
      { id: randomUUID(), serverId: server.id, toolName: "search", startedAt: base, durationMs: 5, success: true, source: "proxy" },
      { id: randomUUID(), serverId: server.id, toolName: "search", startedAt: base + 100, durationMs: 5, success: false, source: "proxy" },
      { id: randomUUID(), serverId: server.id, toolName: "fetch", startedAt: base + 200, durationMs: 5, success: true, source: "health-check" }
    ];
    for (const e of executions) store.recordExecution(e);

    const searchOnly = store.listExecutions({ serverId: server.id, toolName: "search" });
    expect(searchOnly).toHaveLength(2);

    const sinceMiddle = store.listExecutions({ serverId: server.id, since: base + 100 });
    expect(sinceMiddle).toHaveLength(2);

    // Results are most-recent-first.
    const all = store.listExecutions({ serverId: server.id });
    expect(all[0]?.toolName).toBe("fetch");
  });

  it("records and lists drift events", () => {
    const server = makeServer();
    store.upsertServer(server);
    const event: DriftEvent = {
      id: randomUUID(),
      serverId: server.id,
      toolName: "search",
      detectedAt: Date.now(),
      kind: "schema",
      severity: "high",
      description: "schema changed",
      previousValue: "a",
      newValue: "b"
    };
    store.recordDriftEvent(event);
    const events = store.listDriftEvents({ serverId: server.id });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(event);
  });

  it("upserts health scores idempotently for the same window", () => {
    const server = makeServer();
    store.upsertServer(server);
    const score: HealthScore = {
      serverId: server.id,
      windowStart: 0,
      windowEnd: 1000,
      score: 90,
      successRate: 0.9,
      p50LatencyMs: 50,
      p95LatencyMs: 100,
      errorRate: 0.1,
      sampleCount: 10
    };
    store.recordHealthScore(score);
    store.recordHealthScore({ ...score, score: 95 });
    const scores = store.listHealthScores(server.id);
    expect(scores).toHaveLength(1);
    expect(scores[0]?.score).toBe(95);
  });

  it("records alerts and resolves them", () => {
    const server = makeServer();
    store.upsertServer(server);
    const alert: Alert = {
      id: randomUUID(),
      serverId: server.id,
      triggeredAt: Date.now(),
      severity: "critical",
      kind: "unreachable",
      message: "Server did not respond"
    };
    store.recordAlert(alert);
    expect(store.listAlerts({ serverId: server.id, onlyUnresolved: true })).toHaveLength(1);

    store.resolveAlert(alert.id, Date.now());
    expect(store.listAlerts({ serverId: server.id, onlyUnresolved: true })).toHaveLength(0);
    expect(store.listAlerts({ serverId: server.id })).toHaveLength(1);
  });

  it("enforces foreign keys: recording an execution for an unknown server fails", () => {
    expect(() =>
      store.recordExecution({
        id: randomUUID(),
        serverId: "does-not-exist",
        toolName: "search",
        startedAt: Date.now(),
        durationMs: 1,
        success: true,
        source: "proxy"
      })
    ).toThrow();
  });
});
