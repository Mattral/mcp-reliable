#!/usr/bin/env node
/**
 * A deliberately tiny stdio MCP server with three tools:
 *
 *   - echo:  always succeeds, fast. A reliability baseline.
 *   - add:   always succeeds, fast, does real arithmetic.
 *   - flaky: randomly fails ~25% of the time and has variable latency, so
 *            mcp-reliable's health scoring and percentile latency tracking
 *            have something interesting to show in the getting-started demo.
 *
 * Set MCP_RELIABLE_DEMO_MODE=v2 to change `echo`'s output shape and `add`'s
 * input schema — this simulates the kind of change that
 * mcp-reliable's drift detector is built to catch. See docs/getting-started.md.
 *
 * Set MCP_RELIABLE_ARTIFICIAL_DELAY_MS to an integer to make `echo` sleep
 * that many milliseconds before responding (default 0, i.e. no change to
 * the existing fast/instant baseline). This exists so `echo` can produce a
 * genuine, reproducible latency-distribution shift for verifying
 * statistical drift detection end-to-end — see
 * docs/decisions/0015-statistical-drift-detection.md — rather than relying
 * on `flaky`'s randomness, which isn't controllable enough to demonstrate a
 * specific before/after shift on demand.
 *
 * This file avoids TypeScript constructor parameter properties, enums,
 * and namespaces. That was originally so it could be run directly via
 * `node src/index.ts` with no build step, using Node's built-in
 * TypeScript type-stripping — but that feature is Node 22.6+ only, and
 * this project supports Node 20+ (see the root package.json `engines`
 * and CI matrix), so every real usage (the CLI examples, the getting-
 * started guide, and the test suite) now runs the *built* `dist/index.js`
 * instead. The syntax restriction is kept anyway, at no real cost, since
 * it's a trivial constraint for a 3-tool demo server and it means this
 * file remains directly runnable via `node src/index.ts` too, for anyone
 * on Node 22.6+ who wants to skip the build step during quick manual
 * testing. See docs/decisions/0009-reference-server-must-be-built-for-tests.md.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const demoModeV2 = process.env.MCP_RELIABLE_DEMO_MODE === "v2";
const artificialDelayMs = Number(process.env.MCP_RELIABLE_ARTIFICIAL_DELAY_MS ?? 0) || 0;

const server = new McpServer({ name: "reference-mcp-server", version: "1.0.0" });

server.registerTool(
  "echo",
  {
    description: "Echoes back the provided message.",
    inputSchema: { message: z.string().describe("Text to echo back") }
  },
  async ({ message }) => {
    if (artificialDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, artificialDelayMs));
    }
    const payload = demoModeV2 ? { echoed: message, respondedAt: new Date().toISOString() } : { message };
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  }
);

if (demoModeV2) {
  server.registerTool(
    "add",
    {
      description: "Adds two numbers.",
      inputSchema: {
        a: z.number(),
        b: z.number(),
        roundTo: z.number().int().optional().describe("Decimal places to round to")
      }
    },
    async ({ a, b, roundTo }) => {
      const sum = roundTo !== undefined ? Number((a + b).toFixed(roundTo)) : a + b;
      return { content: [{ type: "text", text: JSON.stringify({ sum }) }] };
    }
  );
} else {
  server.registerTool(
    "add",
    { description: "Adds two numbers.", inputSchema: { a: z.number(), b: z.number() } },
    async ({ a, b }) => {
      return { content: [{ type: "text", text: JSON.stringify({ sum: a + b }) }] };
    }
  );
}

server.registerTool(
  "flaky",
  {
    description: "Simulates a real-world unreliable tool: variable latency and occasional failures.",
    inputSchema: {}
  },
  async () => {
    const delayMs = 20 + Math.random() * 780;
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    if (Math.random() < 0.25) {
      return { content: [{ type: "text", text: "simulated transient failure" }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify({ status: "ok", tookMs: Math.round(delayMs) }) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
