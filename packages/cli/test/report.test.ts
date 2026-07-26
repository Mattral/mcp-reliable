import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "@mattral/core";
import { SqliteStore } from "@mattral/storage";
import { HEALTH_CHECK_TOOL_NAME } from "@mattral/collector";
import { buildServerReport } from "../src/commands/report.js";

function makeServer(overrides: Partial<Server> = {}): Server {
  return {
    id: "srv-1",
    name: "test-server",
    transport: { type: "stdio", command: "npx", args: ["thing"] },
    tags: [],
    createdAt: Date.now(),
    healthCheckIntervalMs: 60_000,
    ...overrides
  };
}

describe("buildServerReport", () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore({ path: ":memory:" });
  });

  afterEach(() => {
    store.close();
  });

  it("reports undefined reachability and health when there is no data in the window", () => {
    const server = makeServer();
    store.upsertServer(server);
    const report = buildServerReport(store, server, 0, 1000);
    expect(report.reachabilityRate).toBeUndefined();
    expect(report.healthScore).toBeUndefined();
  });

  it("computes reachability from health-check executions only", () => {
    const server = makeServer();
    store.upsertServer(server);
    const now = 5000;
    store.recordExecution({
      id: randomUUID(),
      serverId: server.id,
      toolName: HEALTH_CHECK_TOOL_NAME,
      startedAt: now,
      durationMs: 10,
      success: true,
      source: "health-check"
    });
    store.recordExecution({
      id: randomUUID(),
      serverId: server.id,
      toolName: HEALTH_CHECK_TOOL_NAME,
      startedAt: now + 10,
      durationMs: 10,
      success: false,
      source: "health-check"
    });

    const report = buildServerReport(store, server, 0, 10_000);
    expect(report.reachabilityRate).toBe(0.5);
    // No proxy traffic recorded, so no tool health score yet.
    expect(report.healthScore).toBeUndefined();
  });

  it("computes a tool health score from proxy executions only, ignoring health checks", () => {
    const server = makeServer();
    store.upsertServer(server);
    const now = 5000;

    store.recordExecution({
      id: randomUUID(),
      serverId: server.id,
      toolName: HEALTH_CHECK_TOOL_NAME,
      startedAt: now,
      durationMs: 5000, // deliberately slow/bad, should NOT affect the tool health score
      success: false,
      source: "health-check"
    });
    for (let i = 0; i < 10; i++) {
      store.recordExecution({
        id: randomUUID(),
        serverId: server.id,
        toolName: "search",
        startedAt: now + i,
        durationMs: 50,
        success: true,
        source: "proxy"
      });
    }

    const report = buildServerReport(store, server, 0, 10_000);
    expect(report.healthScore).toBeDefined();
    expect(report.healthScore?.successRate).toBe(1);
    expect(report.healthScore?.sampleCount).toBe(10);
  });

  it("persists the computed health score for historical trending", () => {
    const server = makeServer();
    store.upsertServer(server);
    for (let i = 0; i < 5; i++) {
      store.recordExecution({
        id: randomUUID(),
        serverId: server.id,
        toolName: "search",
        startedAt: 1000 + i,
        durationMs: 20,
        success: true,
        source: "proxy"
      });
    }
    buildServerReport(store, server, 0, 10_000);
    const scores = store.listHealthScores(server.id);
    expect(scores).toHaveLength(1);
  });

  it("factors unresolved drift events into the score via the penalty formula", () => {
    const server = makeServer();
    store.upsertServer(server);
    for (let i = 0; i < 10; i++) {
      store.recordExecution({
        id: randomUUID(),
        serverId: server.id,
        toolName: "search",
        startedAt: 1000 + i,
        durationMs: 20,
        success: true,
        source: "proxy"
      });
    }
    store.recordDriftEvent({
      id: randomUUID(),
      serverId: server.id,
      toolName: "search",
      detectedAt: 1500,
      kind: "schema",
      severity: "high",
      description: "schema changed"
    });

    const withDrift = buildServerReport(store, server, 0, 10_000);
    expect(withDrift.healthScore?.score).toBeLessThan(100);
  });
});
