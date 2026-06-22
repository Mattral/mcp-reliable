import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HealthCheckResult } from "@mcp-reliable/collector";
import type { DriftEvent, Server } from "@mcp-reliable/core";
import { SqliteStore } from "@mcp-reliable/storage";
import {
  reconcileHealthDegradationAlert,
  reconcileUnreachableAlert,
  recordDriftAlerts
} from "../src/commands/monitor.js";

function makeServer(): Server {
  return {
    id: "srv-1",
    name: "test-server",
    transport: { type: "stdio", command: "npx", args: [] },
    tags: [],
    createdAt: Date.now(),
    healthCheckIntervalMs: 60_000
  };
}

function result(overrides: Partial<HealthCheckResult> = {}): HealthCheckResult {
  return {
    serverId: "srv-1",
    reachable: true,
    latencyMs: 10,
    toolCount: 1,
    driftEvents: [],
    ...overrides
  };
}

describe("reconcileUnreachableAlert", () => {
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

  it("does nothing while the server stays reachable", () => {
    const outcome = reconcileUnreachableAlert(store, server, result({ reachable: true }));
    expect(store.listAlerts({ serverId: server.id })).toHaveLength(0);
    expect(outcome.opened).toBeNull();
    expect(outcome.resolved).toHaveLength(0);
  });

  it("opens a critical alert the first time the server becomes unreachable", () => {
    const outcome = reconcileUnreachableAlert(store, server, result({ reachable: false, error: "ECONNREFUSED" }));
    const alerts = store.listAlerts({ serverId: server.id });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.severity).toBe("critical");
    expect(alerts[0]?.kind).toBe("unreachable");
    expect(alerts[0]?.resolvedAt).toBeUndefined();
    expect(outcome.opened?.kind).toBe("unreachable");
    expect(outcome.resolved).toHaveLength(0);
  });

  it("does not open a duplicate alert on repeated unreachable checks", () => {
    reconcileUnreachableAlert(store, server, result({ reachable: false }));
    const second = reconcileUnreachableAlert(store, server, result({ reachable: false }));
    reconcileUnreachableAlert(store, server, result({ reachable: false }));
    expect(store.listAlerts({ serverId: server.id })).toHaveLength(1);
    expect(second.opened).toBeNull(); // already open, nothing new to report
  });

  it("resolves the alert once the server becomes reachable again", () => {
    reconcileUnreachableAlert(store, server, result({ reachable: false }));
    const outcome = reconcileUnreachableAlert(store, server, result({ reachable: true }));

    const alerts = store.listAlerts({ serverId: server.id });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.resolvedAt).toBeDefined();
    expect(store.listAlerts({ serverId: server.id, onlyUnresolved: true })).toHaveLength(0);
    expect(outcome.resolved).toHaveLength(1);
    expect(outcome.resolved[0]?.kind).toBe("unreachable");
  });

  it("can open a new alert again after a resolved flap", () => {
    reconcileUnreachableAlert(store, server, result({ reachable: false }));
    reconcileUnreachableAlert(store, server, result({ reachable: true }));
    reconcileUnreachableAlert(store, server, result({ reachable: false }));

    expect(store.listAlerts({ serverId: server.id, onlyUnresolved: true })).toHaveLength(1);
    expect(store.listAlerts({ serverId: server.id })).toHaveLength(2);
  });
});

describe("recordDriftAlerts", () => {
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

  function driftEvent(overrides: Partial<DriftEvent> = {}): DriftEvent {
    return {
      id: randomUUID(),
      serverId: server.id,
      toolName: "search",
      detectedAt: Date.now(),
      kind: "schema",
      severity: "high",
      description: "schema changed",
      ...overrides
    };
  }

  it("returns an empty array and records nothing for no drift events", () => {
    expect(recordDriftAlerts(store, [])).toHaveLength(0);
    expect(store.listAlerts({ serverId: server.id })).toHaveLength(0);
  });

  it("records one alert per drift event, mapping severity across", () => {
    const alerts = recordDriftAlerts(store, [driftEvent({ severity: "high" }), driftEvent({ severity: "low" })]);
    expect(alerts).toHaveLength(2);
    expect(alerts[0]?.severity).toBe("critical");
    expect(alerts[1]?.severity).toBe("info");
    expect(store.listAlerts({ serverId: server.id })).toHaveLength(2);
  });

  it("never marks drift alerts as resolved", () => {
    const [alert] = recordDriftAlerts(store, [driftEvent()]);
    expect(alert?.resolvedAt).toBeUndefined();
  });
});

describe("reconcileHealthDegradationAlert", () => {
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

  function recordProxyExecutions(count: number, success: boolean, durationMs = 20, startedAt = Date.now()) {
    for (let i = 0; i < count; i++) {
      store.recordExecution({
        id: randomUUID(),
        serverId: server.id,
        toolName: "search",
        startedAt,
        durationMs,
        success,
        source: "proxy"
      });
    }
  }

  it("returns an undefined healthScore and no alert when there is no proxy traffic yet", () => {
    const outcome = reconcileHealthDegradationAlert(store, server, 3_600_000);
    expect(outcome.healthScore).toBeUndefined();
    expect(outcome.opened).toBeNull();
    expect(outcome.resolved).toHaveLength(0);
  });

  it("does not alert when the server is healthy", () => {
    recordProxyExecutions(10, true);
    const outcome = reconcileHealthDegradationAlert(store, server, 3_600_000);
    expect(outcome.healthScore?.score).toBeGreaterThanOrEqual(90);
    expect(outcome.opened).toBeNull();
  });

  it("opens a health-degradation alert on the first check that finds it degraded", () => {
    recordProxyExecutions(10, false); // 0% success -> score 0
    const outcome = reconcileHealthDegradationAlert(store, server, 3_600_000);
    expect(outcome.opened?.kind).toBe("health-degradation");
    expect(outcome.opened?.severity).toBe("critical");
    expect(store.listAlerts({ serverId: server.id, onlyUnresolved: true })).toHaveLength(1);
  });

  it("does not re-alert on a second check that is still in the same degraded band", () => {
    recordProxyExecutions(10, false);
    reconcileHealthDegradationAlert(store, server, 3_600_000);
    recordProxyExecutions(10, false);
    const second = reconcileHealthDegradationAlert(store, server, 3_600_000);
    expect(second.opened).toBeNull();
    expect(store.listAlerts({ serverId: server.id })).toHaveLength(1); // still just the one
  });

  it("resolves the open alert once the server recovers", () => {
    const twoHoursAgo = Date.now() - 2 * 3_600_000;
    recordProxyExecutions(10, false, 20, twoHoursAgo);
    // A 1h window at this point only sees the (all-failing) executions from
    // two hours ago... except those are now outside the window too. Use a
    // window wide enough to see them for the "opens" half of this test.
    reconcileHealthDegradationAlert(store, server, 4 * 3_600_000);
    expect(store.listAlerts({ serverId: server.id, onlyUnresolved: true })).toHaveLength(1);

    // Now record fresh, healthy traffic and check again with the *default*
    // 1h window — the old failures (2h ago) have aged out entirely, so the
    // score reflects only the new, healthy traffic.
    recordProxyExecutions(10, true, 20, Date.now());
    const outcome = reconcileHealthDegradationAlert(store, server, 3_600_000);
    expect(outcome.healthScore?.score).toBeGreaterThanOrEqual(90);
    expect(outcome.resolved.length).toBeGreaterThan(0);
    expect(store.listAlerts({ serverId: server.id, onlyUnresolved: true })).toHaveLength(0);
  });

  it("persists a health score snapshot as a side effect, feeding the history chart", () => {
    recordProxyExecutions(5, true);
    reconcileHealthDegradationAlert(store, server, 3_600_000);
    expect(store.listHealthScores(server.id)).toHaveLength(1);
  });
});
