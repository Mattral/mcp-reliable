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
 * This file intentionally avoids TypeScript constructor parameter
 * properties, enums, and namespaces so it can be executed directly via
 * `node src/index.ts` (Node's built-in type-stripping) with no build step —
 * both in mcp-reliable's own collector tests and for anyone trying the demo.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const demoModeV2 = process.env.MCP_RELIABLE_DEMO_MODE === "v2";

const server = new McpServer({ name: "reference-mcp-server", version: "0.1.0" });

server.registerTool(
  "echo",
  {
    description: "Echoes back the provided message.",
    inputSchema: { message: z.string().describe("Text to echo back") }
  },
  async ({ message }) => {
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
