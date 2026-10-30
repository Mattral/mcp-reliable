import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@mattral/core";
import { SqliteStore } from "@mattral/storage";
import { createAgentServer } from "../src/server.js";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

function makeServer(overrides: Partial<Server> = {}): Server {
  return {
    id: "srv-1",
    name: "test-server",
    transport: { type: "stdio", command: "npx", args: [], env: { SECRET: "shh" } },
    tags: ["demo"],
    createdAt: Date.now(),
    healthCheckIntervalMs: 60_000,
    ...overrides
  };
}

async function connectedClient(store: SqliteStore) {
  const agentServer = createAgentServer(store);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.1" }, { capabilities: {} });
  await Promise.all([agentServer.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function parseToolResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const content = result.content as Array<{ type: string; text?: string }>;
  const first = content[0];
  if (!first || first.type !== "text" || first.text === undefined) {
    throw new Error("Expected a single text content block");
  }
  return JSON.parse(first.text);
}

describe("agent-interface tools (via a real MCP Client, InMemoryTransport)", () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore({ path: ":memory:" });
  });

  afterEach(() => {
    store.close();
  });

  it("reports this package's own version to clients", async () => {
    const client = await connectedClient(store);
    expect(client.getServerVersion()).toEqual({ name: "mcp-reliable", version: packageJson.version });
    await client.close();
  });

  it("exposes exactly the expected tool names", async () => {
    const client = await connectedClient(store);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_recommendation",
      "get_server_health",
      "list_alerts",
      "list_drift_events",
      "list_recommendations",
      "list_servers"
    ]);
    await client.close();
  });

  it("list_servers returns registered servers without leaking transport secrets", async () => {
    store.upsertServer(makeServer());
    const client = await connectedClient(store);

    const result = await client.callTool({ name: "list_servers", arguments: {} });
    const body = parseToolResult(result) as { servers: Array<{ id: string; name: string; tags: string[] }> };

    expect(body.servers).toHaveLength(1);
    expect(body.servers[0]).toEqual({ id: "srv-1", name: "test-server", tags: ["demo"], transportType: "stdio" });
    expect(JSON.stringify(body)).not.toContain("shh"); // the secret env value never appears

    await client.close();
  });

  it("get_server_health returns an error result for an unknown server id", async () => {
    const client = await connectedClient(store);
    const result = await client.callTool({ name: "get_server_health", arguments: { serverId: "nope" } });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("get_server_health reflects real recorded data", async () => {
    store.upsertServer(makeServer());
    for (let i = 0; i < 10; i++) {
      store.recordExecution({
        id: randomUUID(),
        serverId: "srv-1",
        toolName: "search",
        startedAt: Date.now(),
        durationMs: 20,
        success: true,
        source: "proxy"
      });
    }
    const client = await connectedClient(store);
    const result = await client.callTool({ name: "get_server_health", arguments: { serverId: "srv-1" } });
    const body = parseToolResult(result) as { healthScore: { score: number; sampleCount: number } | null };

    expect(body.healthScore).not.toBeNull();
    expect(body.healthScore?.sampleCount).toBe(10);
    expect(body.healthScore?.score).toBeCloseTo(100, 5);

    await client.close();
  });

  it("list_drift_events returns recorded drift for a server", async () => {
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
    const client = await connectedClient(store);
    const result = await client.callTool({ name: "list_drift_events", arguments: { serverId: "srv-1" } });
    const body = parseToolResult(result) as { driftEvents: unknown[] };
    expect(body.driftEvents).toHaveLength(1);
    await client.close();
  });

  it("list_alerts filters by onlyUnresolved", async () => {
    store.upsertServer(makeServer());
    store.recordAlert({
      id: randomUUID(),
      serverId: "srv-1",
      triggeredAt: Date.now(),
      severity: "critical",
      kind: "unreachable",
      message: "down"
    });
    const client = await connectedClient(store);
    const all = parseToolResult(
      await client.callTool({ name: "list_alerts", arguments: { serverId: "srv-1" } })
    ) as { alerts: unknown[] };
    const unresolved = parseToolResult(
      await client.callTool({ name: "list_alerts", arguments: { serverId: "srv-1", onlyUnresolved: true } })
    ) as { alerts: unknown[] };
    expect(all.alerts).toHaveLength(1);
    expect(unresolved.alerts).toHaveLength(1);
    await client.close();
  });

  it("get_recommendation returns avoid for an unreachable server", async () => {
    store.upsertServer(makeServer());
    store.recordExecution({
      id: randomUUID(),
      serverId: "srv-1",
      toolName: "__health_check__",
      startedAt: Date.now(),
      durationMs: 5,
      success: false,
      source: "health-check"
    });
    const client = await connectedClient(store);
    const result = await client.callTool({ name: "get_recommendation", arguments: { serverId: "srv-1" } });
    const body = parseToolResult(result) as { level: string; reason: string };
    expect(body.level).toBe("avoid");
    await client.close();
  });

  it("get_recommendation returns unknown for a server with no data yet", async () => {
    store.upsertServer(makeServer());
    const client = await connectedClient(store);
    const result = await client.callTool({ name: "get_recommendation", arguments: { serverId: "srv-1" } });
    const body = parseToolResult(result) as { level: string };
    expect(body.level).toBe("unknown");
    await client.close();
  });

  it("list_recommendations covers every registered server in one call", async () => {
    store.upsertServer(makeServer({ id: "srv-1", name: "alpha" }));
    store.upsertServer(makeServer({ id: "srv-2", name: "beta", transport: { type: "stdio", command: "node" } }));
    const client = await connectedClient(store);
    const result = await client.callTool({ name: "list_recommendations", arguments: {} });
    const body = parseToolResult(result) as { recommendations: Array<{ serverId: string }> };
    expect(body.recommendations.map((r) => r.serverId).sort()).toEqual(["srv-1", "srv-2"]);
    await client.close();
  });

  it("list_drift_events and list_alerts return an error for an unknown server id", async () => {
    const client = await connectedClient(store);
    const drift = await client.callTool({ name: "list_drift_events", arguments: { serverId: "nope" } });
    const alerts = await client.callTool({ name: "list_alerts", arguments: { serverId: "nope" } });
    expect(drift.isError).toBe(true);
    expect(alerts.isError).toBe(true);
    await client.close();
  });
});
