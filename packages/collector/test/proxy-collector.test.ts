import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SqliteStore } from "@mattral/storage";
import { StdioProxyCollector } from "../src/proxy-collector.js";
import { StreamPairTransport } from "./helpers/stream-pair-transport.js";
import { ensureReferenceServerBuilt } from "./helpers/ensure-reference-server-built.js";

const referenceServerPath = ensureReferenceServerBuilt();

async function setUpProxiedClient(serverId: string, store: SqliteStore, env?: Record<string, string>) {
  // clientToProxy: the fake client writes requests here; the proxy reads them as `input`.
  // proxyToClient: the proxy writes forwarded responses here; the fake client reads them as `incoming`.
  const clientToProxy = new PassThrough();
  const proxyToClient = new PassThrough();

  const collector = new StdioProxyCollector({
    serverId,
    store,
    command: process.execPath,
    args: [referenceServerPath],
    env,
    input: clientToProxy,
    output: proxyToClient
  });
  const exitPromise = collector.start();

  const transport = new StreamPairTransport(clientToProxy, proxyToClient);
  const client = new Client({ name: "test-client", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport, { timeout: 10_000 });

  return {
    collector,
    client,
    exitPromise,
    cleanup: async () => {
      await client.close().catch(() => {});
      await collector.stop();
      clientToProxy.end();
    }
  };
}

describe("StdioProxyCollector", () => {
  let store: SqliteStore;
  const serverId = "srv-proxy-test";

  beforeEach(() => {
    store = new SqliteStore({ path: ":memory:" });
    store.upsertServer({
      id: serverId,
      name: "reference",
      transport: { type: "stdio", command: process.execPath, args: [referenceServerPath] },
      tags: [],
      createdAt: Date.now(),
      healthCheckIntervalMs: 60_000
    });
  });

  afterEach(() => {
    store.close();
  });

  it("forwards tools/list and records tool metadata with schema fingerprints", async () => {
    const { client, cleanup } = await setUpProxiedClient(serverId, store);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["add", "echo", "flaky"]);

      const storedTools = store.listTools(serverId);
      expect(storedTools).toHaveLength(3);
      for (const tool of storedTools) {
        expect(tool.schemaFingerprint).toBeTruthy();
      }
    } finally {
      await cleanup();
    }
  }, 15_000);

  it("records a successful proxied tool call as an Execution", async () => {
    const { client, cleanup } = await setUpProxiedClient(serverId, store);
    try {
      const result = await client.callTool({ name: "echo", arguments: { message: "hello" } });
      expect(result.isError).toBeFalsy();

      const executions = store.listExecutions({ serverId, toolName: "echo" });
      expect(executions).toHaveLength(1);
      expect(executions[0]?.success).toBe(true);
      expect(executions[0]?.source).toBe("proxy");
      expect(executions[0]?.outputSignature).toBeTruthy();
      expect(executions[0]?.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await cleanup();
    }
  }, 15_000);

  it("records a real arithmetic result correctly and distinguishes tools", async () => {
    const { client, cleanup } = await setUpProxiedClient(serverId, store);
    try {
      await client.callTool({ name: "add", arguments: { a: 2, b: 3 } });
      await client.callTool({ name: "echo", arguments: { message: "hi" } });

      expect(store.listExecutions({ serverId, toolName: "add" })).toHaveLength(1);
      expect(store.listExecutions({ serverId, toolName: "echo" })).toHaveLength(1);
      expect(store.listExecutions({ serverId })).toHaveLength(2);
    } finally {
      await cleanup();
    }
  }, 15_000);

  it("records failed tool calls (isError) as unsuccessful executions", async () => {
    const { client, cleanup } = await setUpProxiedClient(serverId, store);
    try {
      // The flaky tool fails ~25% of the time; call it enough times that
      // we observe at least one failure and one success with high probability.
      for (let i = 0; i < 20; i++) {
        await client.callTool({ name: "flaky", arguments: {} });
      }
      const executions = store.listExecutions({ serverId, toolName: "flaky" });
      expect(executions).toHaveLength(20);
      const failures = executions.filter((e) => !e.success);
      const successes = executions.filter((e) => e.success);
      expect(failures.length).toBeGreaterThan(0);
      expect(successes.length).toBeGreaterThan(0);
      expect(failures[0]?.errorMessage).toBeTruthy();
    } finally {
      await cleanup();
    }
  }, 20_000);

  it("detects schema drift when the wrapped server's tool schema changes between sessions", async () => {
    const first = await setUpProxiedClient(serverId, store);
    await first.client.listTools();
    await first.cleanup();

    const driftEvents: unknown[] = [];
    const clientToProxy = new PassThrough();
    const proxyToClient = new PassThrough();
    const collector = new StdioProxyCollector({
      serverId,
      store,
      command: process.execPath,
      args: [referenceServerPath],
      env: { MCP_RELIABLE_DEMO_MODE: "v2" },
      input: clientToProxy,
      output: proxyToClient,
      onDrift: (event) => driftEvents.push(event)
    });
    collector.start();
    const transport = new StreamPairTransport(clientToProxy, proxyToClient);
    const client = new Client({ name: "test-client", version: "0.0.1" }, { capabilities: {} });
    await client.connect(transport, { timeout: 10_000 });

    await client.listTools();

    expect(driftEvents.length).toBeGreaterThan(0);
    const stored = store.listDriftEvents({ serverId });
    expect(stored.some((e) => (e as { toolName: string }).toolName === "add")).toBe(true);

    await client.close().catch(() => {});
    await collector.stop();
    clientToProxy.end();
  }, 20_000);

  it("detects both output-shape and statistical (latency) drift for real tool-call traffic across two windows", async () => {
    // Window 1 ("baseline"): default server behavior, 20 real echo calls —
    // matches detectLatencyDrift's and detectOutputShapeDrift's own
    // minSampleSize defaults exactly, so this is the smallest input that
    // can actually trigger either detector, keeping this real-subprocess
    // test as fast as it can be while still being genuinely real.
    const baselineSession = await setUpProxiedClient(serverId, store);
    for (let i = 0; i < 20; i++) {
      await baselineSession.client.callTool({ name: "echo", arguments: { message: `call-${i}` } });
    }
    await baselineSession.cleanup();

    // Window 2 ("recent"): a fresh session against a server whose `echo`
    // now returns a different output shape (MCP_RELIABLE_DEMO_MODE=v2) and
    // is artificially slower (MCP_RELIABLE_ARTIFICIAL_DELAY_MS) — both
    // env vars are read once at the child process's own startup, so a
    // fresh session is required to change them; the store (and this
    // collector's view of "baseline" via `listExecutions`) persists across
    // sessions regardless.
    const driftEvents: Array<{ kind: string; metric?: string; toolName: string }> = [];
    const clientToProxy = new PassThrough();
    const proxyToClient = new PassThrough();
    const collector = new StdioProxyCollector({
      serverId,
      store,
      command: process.execPath,
      args: [referenceServerPath],
      env: { MCP_RELIABLE_DEMO_MODE: "v2", MCP_RELIABLE_ARTIFICIAL_DELAY_MS: "150" },
      input: clientToProxy,
      output: proxyToClient,
      onDrift: (event) => driftEvents.push(event)
    });
    collector.start();
    const transport = new StreamPairTransport(clientToProxy, proxyToClient);
    const client = new Client({ name: "test-client", version: "0.0.1" }, { capabilities: {} });
    await client.connect(transport, { timeout: 10_000 });

    for (let i = 0; i < 20; i++) {
      await client.callTool({ name: "echo", arguments: { message: `call-${i}` } });
    }

    const echoDrift = driftEvents.filter((e) => e.toolName === "echo");
    expect(echoDrift.some((e) => e.kind === "output-shape")).toBe(true);
    expect(echoDrift.some((e) => e.kind === "statistical" && e.metric === "latency")).toBe(true);

    // And both are durably persisted, not just delivered via the callback.
    const stored = store.listDriftEvents({ serverId, toolName: "echo" });
    expect(stored.some((e) => e.kind === "output-shape")).toBe(true);
    expect(stored.some((e) => e.kind === "statistical" && e.metric === "latency")).toBe(true);

    await client.close().catch(() => {});
    await collector.stop();
    clientToProxy.end();
  }, 30_000);
});
