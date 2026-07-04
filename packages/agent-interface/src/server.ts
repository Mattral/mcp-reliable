import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ReliabilityStore } from "@mcp-reliable/storage";
import { registerAgentTools } from "./tools.js";

export interface CreateAgentServerOptions {
  name?: string;
  version?: string;
}

/** Builds (but does not connect) an MCP server exposing mcp-reliable's own data. Connect it to whatever transport fits — stdio via `runAgentServerOnStdio` below, or an in-memory transport for tests. */
export function createAgentServer(store: ReliabilityStore, options: CreateAgentServerOptions = {}): McpServer {
  const server = new McpServer({
    name: options.name ?? "mcp-reliable",
    version: options.version ?? "0.1.0"
  });
  registerAgentTools(server, store);
  return server;
}

/**
 * Runs the agent-facing MCP interface over stdio until the client
 * disconnects — the shape the CLI's `mcp` command needs. Kept here rather
 * than duplicated in `packages/cli` so that package doesn't need a direct
 * `@modelcontextprotocol/sdk` dependency of its own; see
 * `decisions/0011-agent-interface-design.md`.
 *
 * `server.connect(transport)` resolves once the initial handshake
 * completes, not when the session ends — awaiting only that (an earlier
 * version of this function did exactly that) let the CLI's `finally {
 * store.close() }` run immediately after connecting, before any tool call
 * had a chance to execute. This waits for the underlying `Server`'s
 * `onclose` callback (fired once, for any reason the connection ends,
 * including an explicit `close()`) so the promise doesn't resolve until
 * the client actually disconnects.
 */
export async function runAgentServerOnStdio(store: ReliabilityStore): Promise<void> {
  const server = createAgentServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  await new Promise<void>((resolve) => {
    server.server.onclose = resolve;
  });
}
