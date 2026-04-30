import { StdioProxyCollector } from "@mcp-reliable/collector";
import { openStore } from "../config.js";
import { CliError } from "../errors.js";

export interface ProxyOptions {
  db?: string;
}

/**
 * IMPORTANT: every diagnostic in this command must go to **stderr**, never
 * stdout. Once running, this process's stdout is the live MCP JSON-RPC
 * channel back to the real client — writing anything else to it would
 * corrupt the protocol stream. This is why `proxy` uses `process.stderr`
 * directly instead of the CLI's usual `console.log`/chalk output.
 */
export async function runProxy(serverId: string, command: string[], options: ProxyOptions): Promise<void> {
  if (command.length === 0) {
    // Not a CliError: we're about to be a live stdio server, so even this
    // usage error must go to stderr, and we exit rather than throwing up
    // through the friendly-error wrapper (which prints via console.error,
    // i.e. stderr too — but being explicit here keeps the invariant local).
    process.stderr.write(
      "mcp-reliable proxy: no command given. Usage: mcp-reliable proxy <server-id> -- <command> [args...]\n"
    );
    process.exitCode = 1;
    return;
  }

  const { store } = openStore({ dbPath: options.db });
  const [cmd, ...args] = command as [string, ...string[]];

  try {
    let server = store.getServer(serverId);
    if (!server) {
      server = {
        id: serverId,
        name: serverId,
        transport: { type: "stdio", command: cmd, args },
        tags: [],
        createdAt: Date.now(),
        healthCheckIntervalMs: 60_000
      };
      store.upsertServer(server);
      process.stderr.write(`mcp-reliable proxy: registered new server "${serverId}"\n`);
    }

    process.stderr.write(`mcp-reliable proxy: wrapping "${[cmd, ...args].join(" ")}" as server "${serverId}"\n`);

    const collector = new StdioProxyCollector({
      serverId,
      store,
      command: cmd,
      args,
      cwd: process.cwd(),
      onDrift: (event) => {
        process.stderr.write(`mcp-reliable proxy: drift detected — ${event.description}\n`);
      }
    });

    const exitCode = await collector.start();
    process.exitCode = exitCode ?? 0;
  } catch (error) {
    const message = error instanceof CliError ? error.message : error instanceof Error ? error.message : String(error);
    process.stderr.write(`mcp-reliable proxy: ${message}\n`);
    process.exitCode = 1;
  } finally {
    store.close();
  }
}
