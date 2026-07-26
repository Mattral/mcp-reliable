import { runAgentServerOnStdio } from "@mattral/agent-interface";
import { openStore } from "../config.js";

export interface McpOptions {
  db?: string;
}

/**
 * IMPORTANT: same invariant as `proxy.ts` — this process's stdout is the
 * live MCP JSON-RPC channel once running. All diagnostics go to stderr.
 */
export async function runMcp(options: McpOptions): Promise<void> {
  const { store } = openStore({ dbPath: options.db });
  process.stderr.write("mcp-reliable mcp: agent-facing MCP interface ready on stdio\n");

  try {
    await runAgentServerOnStdio(store);
  } catch (error) {
    process.stderr.write(`mcp-reliable mcp: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    store.close();
  }
}
