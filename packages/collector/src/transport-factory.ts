import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { TransportConfig } from "@mattral/core";

/**
 * Builds the appropriate official SDK client transport for a server's
 * configured transport, used by {@link HealthChecker}. The stdio proxy
 * collector does *not* use this — it talks to the child process directly
 * (see docs/architecture.md#transport-adapters for why the two collection
 * modes have different transport-handling needs).
 */
export function createClientTransport(config: TransportConfig): Transport {
  switch (config.type) {
    case "stdio":
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
        cwd: config.cwd
      });
    case "sse":
      return new SSEClientTransport(new URL(config.url), {
        requestInit: config.headers ? { headers: config.headers } : undefined
      });
    case "http":
      return new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: config.headers ? { headers: config.headers } : undefined
      });
    default: {
      const exhaustiveCheck: never = config;
      throw new Error(`Unsupported transport config: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}
