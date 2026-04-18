import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "@mcp-reliable/core";
import { SqliteStore } from "@mcp-reliable/storage";
import { HealthChecker, HEALTH_CHECK_TOOL_NAME } from "../src/health-checker.js";

const referenceServerPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../examples/reference-mcp-server/src/index.ts"
);

function makeServer(overrides: Partial<Server> = {}): Server {
  return {
    id: "srv-health-test",
    name: "reference",
    transport: { type: "stdio", command: process.execPath, args: [referenceServerPath] },
    tags: [],
    createdAt: Date.now(),
    healthCheckIntervalMs: 60_000,
    ...overrides
  };
}

describe("HealthChecker", () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore({ path: ":memory:" });
  });

  afterEach(() => {
    store.close();
  });

  it("reports a server reachable, lists its tools, and records a health-check execution", async () => {
    const server = makeServer();
    store.upsertServer(server);
    const checker = new HealthChecker({ store });

    const result = await checker.check(server);

    expect(result.reachable).toBe(true);
    expect(result.toolCount).toBe(3);
    expect(result.driftEvents).toHaveLength(0); // first observation, nothing to compare against
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    const tools = store.listTools(server.id);
    expect(tools.map((t) => t.name).sort()).toEqual(["add", "echo", "flaky"]);

    const executions = store.listExecutions({ serverId: server.id, toolName: HEALTH_CHECK_TOOL_NAME });
    expect(executions).toHaveLength(1);
    expect(executions[0]?.success).toBe(true);
    expect(executions[0]?.source).toBe("health-check");
  }, 15_000);

  it("never invokes an actual tool — only initialize and tools/list", async () => {
    const server = makeServer();
    store.upsertServer(server);
    const checker = new HealthChecker({ store });

    await checker.check(server);

    // The only executions recorded should be the health-check pseudo-call;
    // no real tool name (echo/add/flaky) should ever appear.
    const executions = store.listExecutions({ serverId: server.id });
    expect(executions.every((e) => e.toolName === HEALTH_CHECK_TOOL_NAME)).toBe(true);
  }, 15_000);

  it("reports unreachable for a server that cannot be started", async () => {
    const server = makeServer({
      id: "srv-broken",
      transport: { type: "stdio", command: "this-command-does-not-exist-anywhere" }
    });
    store.upsertServer(server);
    const checker = new HealthChecker({ store, timeoutMs: 2000 });

    const result = await checker.check(server);

    expect(result.reachable).toBe(false);
    expect(result.error).toBeTruthy();

    const executions = store.listExecutions({ serverId: server.id });
    expect(executions).toHaveLength(1);
    expect(executions[0]?.success).toBe(false);
  }, 10_000);

  it("detects schema drift when the server's tool schema changes between checks", async () => {
    const server = makeServer();
    store.upsertServer(server);
    const checker = new HealthChecker({ store });

    const first = await checker.check(server);
    expect(first.driftEvents).toHaveLength(0);

    const changedServer = makeServer({
      transport: {
        type: "stdio",
        command: process.execPath,
        args: [referenceServerPath],
        env: { MCP_RELIABLE_DEMO_MODE: "v2" }
      }
    });
    const second = await checker.check(changedServer);

    expect(second.driftEvents.length).toBeGreaterThan(0);
    expect(second.driftEvents.some((e) => e.toolName === "add" && e.severity === "high")).toBe(true);

    const stored = store.listDriftEvents({ serverId: server.id });
    expect(stored.length).toBeGreaterThan(0);
  }, 15_000);
});
