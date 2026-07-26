import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "@mattral/core";
import { SqliteStore } from "@mattral/storage";
import { computeAgentHealthSummary } from "../src/health-summary.js";

function makeServer(overrides: Partial<Server> = {}): Server {
  return {
    id: "srv-1",
    name: "test-server",
    transport: { type: "stdio", command: "npx", args: [] },
    tags: [],
    createdAt: Date.now(),
    healthCheckIntervalMs: 60_000,
    ...overrides
  };
}

describe("computeAgentHealthSummary", () => {
  let store: SqliteStore;
  let server: Server;

  beforeEach(() => {
    store = new SqliteStore({ path: ":memory:" });
    server = makeServer();
    store.upsertServer(server);
  });

  afterEach(() => {
    store.close();
  });

  it("returns null reachable and null healthScore with no data at all", () => {
    const summary = computeAgentHealthSummary(store, server, 3_600_000);
    expect(summary.reachable).toBeNull();
    expect(summary.healthScore).toBeNull();
    expect(summary.unresolvedAlertCount).toBe(0);
  });

  it("reflects the most recent health check's outcome, not an aggregate", () => {
    store.recordExecution({
      id: randomUUID(),
      serverId: server.id,
      toolName: "__health_check__",
      startedAt: 1000,
      durationMs: 5,
      success: false,
      source: "health-check"
    });
    store.recordExecution({
      id: randomUUID(),
      serverId: server.id,
      toolName: "__health_check__",
      startedAt: 2000,
      durationMs: 5,
      success: true,
      source: "health-check"
    });
    expect(computeAgentHealthSummary(store, server, 3_600_000).reachable).toBe(true);
  });

  it("does NOT persist a health score snapshot as a side effect (unlike the CLI's report command)", () => {
    for (let i = 0; i < 10; i++) {
      store.recordExecution({
        id: randomUUID(),
        serverId: server.id,
        toolName: "search",
        startedAt: Date.now(),
        durationMs: 20,
        success: true,
        source: "proxy"
      });
    }
    computeAgentHealthSummary(store, server, 3_600_000);
    expect(store.listHealthScores(server.id)).toHaveLength(0);
  });

  it("counts unresolved alerts and total/high-severity drift separately", () => {
    store.recordAlert({
      id: randomUUID(),
      serverId: server.id,
      triggeredAt: Date.now(),
      severity: "critical",
      kind: "unreachable",
      message: "down"
    });
    store.recordDriftEvent({
      id: randomUUID(),
      serverId: server.id,
      toolName: "search",
      detectedAt: Date.now(),
      kind: "schema",
      severity: "high",
      description: "high severity change"
    });
    store.recordDriftEvent({
      id: randomUUID(),
      serverId: server.id,
      toolName: "search",
      detectedAt: Date.now(),
      kind: "output-shape",
      severity: "low",
      description: "minor shape change"
    });

    const summary = computeAgentHealthSummary(store, server, 3_600_000);
    expect(summary.unresolvedAlertCount).toBe(1);
    expect(summary.recentDriftCount).toBe(2);
    expect(summary.recentHighSeverityDriftCount).toBe(1);
  });
});
