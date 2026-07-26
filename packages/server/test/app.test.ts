import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "@mattral/core";
import { SqliteStore } from "@mattral/storage";
import { createApp } from "../src/app.js";

function makeServer(overrides: Partial<Server> = {}): Server {
  return {
    id: "srv-1",
    name: "test-server",
    transport: { type: "stdio", command: "npx", args: ["thing"], env: { API_KEY: "super-secret" } },
    tags: ["demo"],
    createdAt: Date.now(),
    healthCheckIntervalMs: 60_000,
    ...overrides
  };
}

describe("createApp", () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore({ path: ":memory:" });
  });

  afterEach(() => {
    store.close();
  });

  it("GET /api/health returns ok", async () => {
    const app = createApp(store);
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /api/servers lists registered servers with secrets redacted", async () => {
    store.upsertServer(makeServer());
    const app = createApp(store);
    const res = await app.request("/api/servers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { servers: Server[] };
    expect(body.servers).toHaveLength(1);
    const transport = body.servers[0]?.transport as { env?: Record<string, string> };
    expect(transport.env?.API_KEY).toBe("***");
  });

  it("GET /api/servers/:id returns 404 for an unknown server", async () => {
    const app = createApp(store);
    const res = await app.request("/api/servers/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("GET /api/servers/:id returns the server when it exists", async () => {
    store.upsertServer(makeServer());
    const app = createApp(store);
    const res = await app.request("/api/servers/srv-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { server: Server };
    expect(body.server.name).toBe("test-server");
  });

  it("GET /api/servers/:id/health reports null when there is no data yet", async () => {
    store.upsertServer(makeServer());
    const app = createApp(store);
    const res = await app.request("/api/servers/srv-1/health");
    const body = (await res.json()) as { reachabilityRate: unknown; healthScore: unknown };
    expect(body.reachabilityRate).toBeNull();
    expect(body.healthScore).toBeNull();
  });

  it("GET /api/servers/:id/health computes a score from recorded proxy executions", async () => {
    store.upsertServer(makeServer());
    for (let i = 0; i < 10; i++) {
      store.recordExecution({
        id: randomUUID(),
        serverId: "srv-1",
        toolName: "search",
        startedAt: Date.now(),
        durationMs: 50,
        success: true,
        source: "proxy"
      });
    }
    const app = createApp(store);
    const res = await app.request("/api/servers/srv-1/health");
    const body = (await res.json()) as { healthScore: { score: number; sampleCount: number } | null };
    expect(body.healthScore).not.toBeNull();
    expect(body.healthScore?.sampleCount).toBe(10);
    expect(body.healthScore?.score).toBeCloseTo(100, 5);
  });

  it("GET /api/servers/:id/health reports lastHealthCheck from the most recent check", async () => {
    store.upsertServer(makeServer());
    store.recordExecution({
      id: randomUUID(),
      serverId: "srv-1",
      toolName: "__health_check__",
      startedAt: 1000,
      durationMs: 5,
      success: false,
      source: "health-check"
    });
    store.recordExecution({
      id: randomUUID(),
      serverId: "srv-1",
      toolName: "__health_check__",
      startedAt: 2000,
      durationMs: 5,
      success: true,
      source: "health-check"
    });
    const app = createApp(store);
    const res = await app.request("/api/servers/srv-1/health");
    const body = (await res.json()) as { lastHealthCheck: { success: boolean; at: number } | null };
    // The most recent check (at=2000) succeeded, even though an earlier one failed.
    expect(body.lastHealthCheck).toEqual({ success: true, at: 2000 });
  });

  it("GET /api/servers/health-summary returns a redacted summary for every server", async () => {
    store.upsertServer(makeServer({ id: "srv-1", name: "alpha" }));
    store.upsertServer(makeServer({ id: "srv-2", name: "beta", transport: { type: "stdio", command: "node" } }));
    store.recordExecution({
      id: randomUUID(),
      serverId: "srv-1",
      toolName: "search",
      startedAt: Date.now(),
      durationMs: 20,
      success: true,
      source: "proxy"
    });

    const app = createApp(store);
    const res = await app.request("/api/servers/health-summary");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { servers: Array<{ server: Server; healthScore: unknown }> };
    expect(body.servers).toHaveLength(2);
    expect(body.servers.map((s) => s.server.name).sort()).toEqual(["alpha", "beta"]);

    const alpha = body.servers.find((s) => s.server.name === "alpha");
    expect(alpha?.healthScore).not.toBeNull();
    const alphaTransport = alpha?.server.transport as { env?: Record<string, string> };
    expect(alphaTransport.env?.API_KEY).toBe("***");
  });

  it("GET /api/servers/health-summary is not shadowed by the /:id route", async () => {
    // Regression guard: /api/servers/health-summary must resolve to the
    // summary handler, not be captured as /api/servers/:id with id="health-summary".
    const app = createApp(store);
    const res = await app.request("/api/servers/health-summary");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { servers: unknown };
    expect(Array.isArray(body.servers)).toBe(true);
  });

  it("GET /api/servers/:id/executions filters by tool name", async () => {
    store.upsertServer(makeServer());
    store.recordExecution({
      id: randomUUID(),
      serverId: "srv-1",
      toolName: "search",
      startedAt: Date.now(),
      durationMs: 10,
      success: true,
      source: "proxy"
    });
    store.recordExecution({
      id: randomUUID(),
      serverId: "srv-1",
      toolName: "fetch",
      startedAt: Date.now(),
      durationMs: 10,
      success: true,
      source: "proxy"
    });
    const app = createApp(store);
    const res = await app.request("/api/servers/srv-1/executions?tool=search");
    const body = (await res.json()) as { executions: Array<{ toolName: string }> };
    expect(body.executions).toHaveLength(1);
    expect(body.executions[0]?.toolName).toBe("search");
  });

  it("GET /api/servers/:id/drift returns recorded drift events", async () => {
    store.upsertServer(makeServer());
    store.recordDriftEvent({
      id: randomUUID(),
      serverId: "srv-1",
      toolName: "search",
      detectedAt: Date.now(),
      kind: "schema",
      severity: "high",
      description: "schema changed"
    });
    const app = createApp(store);
    const res = await app.request("/api/servers/srv-1/drift");
    const body = (await res.json()) as { driftEvents: unknown[] };
    expect(body.driftEvents).toHaveLength(1);
  });

  it("GET /api/servers/:id/alerts filters unresolved alerts", async () => {
    store.upsertServer(makeServer());
    store.recordAlert({
      id: randomUUID(),
      serverId: "srv-1",
      triggeredAt: Date.now(),
      severity: "critical",
      kind: "unreachable",
      message: "down"
    });
    const app = createApp(store);
    const resAll = await app.request("/api/servers/srv-1/alerts");
    const resUnresolved = await app.request("/api/servers/srv-1/alerts?onlyUnresolved=true");
    expect(((await resAll.json()) as { alerts: unknown[] }).alerts).toHaveLength(1);
    expect(((await resUnresolved.json()) as { alerts: unknown[] }).alerts).toHaveLength(1);
  });
});
