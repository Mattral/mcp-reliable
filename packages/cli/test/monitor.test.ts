import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HealthCheckResult } from "@mcp-reliable/collector";
import type { Server } from "@mcp-reliable/core";
import { SqliteStore } from "@mcp-reliable/storage";
import { reconcileUnreachableAlert } from "../src/commands/monitor.js";

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
    reconcileUnreachableAlert(store, server, result({ reachable: true }));
    expect(store.listAlerts({ serverId: server.id })).toHaveLength(0);
  });

  it("opens a critical alert the first time the server becomes unreachable", () => {
    reconcileUnreachableAlert(store, server, result({ reachable: false, error: "ECONNREFUSED" }));
    const alerts = store.listAlerts({ serverId: server.id });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.severity).toBe("critical");
    expect(alerts[0]?.kind).toBe("unreachable");
    expect(alerts[0]?.resolvedAt).toBeUndefined();
  });

  it("does not open a duplicate alert on repeated unreachable checks", () => {
    reconcileUnreachableAlert(store, server, result({ reachable: false }));
    reconcileUnreachableAlert(store, server, result({ reachable: false }));
    reconcileUnreachableAlert(store, server, result({ reachable: false }));
    expect(store.listAlerts({ serverId: server.id })).toHaveLength(1);
  });

  it("resolves the alert once the server becomes reachable again", () => {
    reconcileUnreachableAlert(store, server, result({ reachable: false }));
    reconcileUnreachableAlert(store, server, result({ reachable: true }));

    const alerts = store.listAlerts({ serverId: server.id });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.resolvedAt).toBeDefined();
    expect(store.listAlerts({ serverId: server.id, onlyUnresolved: true })).toHaveLength(0);
  });

  it("can open a new alert again after a resolved flap", () => {
    reconcileUnreachableAlert(store, server, result({ reachable: false }));
    reconcileUnreachableAlert(store, server, result({ reachable: true }));
    reconcileUnreachableAlert(store, server, result({ reachable: false }));

    expect(store.listAlerts({ serverId: server.id, onlyUnresolved: true })).toHaveLength(1);
    expect(store.listAlerts({ serverId: server.id })).toHaveLength(2);
  });
});
