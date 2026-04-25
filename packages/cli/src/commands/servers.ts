import chalk from "chalk";
import Table from "cli-table3";
import { openStore } from "../config.js";
import { CliError, withFriendlyErrors } from "../errors.js";

export function runRemoveServer(id: string, options: { db?: string }): Promise<void> {
  return withFriendlyErrors(async () => {
    const { store } = openStore({ dbPath: options.db });
    try {
      const server = store.getServer(id);
      if (!server) {
        throw new CliError(`No server registered with id "${id}".`, "Run `mcp-reliable servers` to list known servers.");
      }
      store.deleteServer(id);
      console.log(chalk.green("✓") + ` Removed server "${server.name}" (id: ${id}) and its history.`);
    } finally {
      store.close();
    }
  })();
}

export function runListServers(options: { db?: string }): Promise<void> {
  return withFriendlyErrors(async () => {
    const { store } = openStore({ dbPath: options.db });
    try {
      const servers = store.listServers();
      if (servers.length === 0) {
        console.log("No servers registered yet.");
        console.log();
        console.log("Register one with:");
        console.log(chalk.cyan("  mcp-reliable add-server --name my-server --stdio -- npx my-mcp-server"));
        return;
      }

      const table = new Table({ head: ["ID", "Name", "Transport", "Tags", "Check interval"] });
      for (const server of servers) {
        const transportSummary =
          server.transport.type === "stdio"
            ? `stdio: ${server.transport.command}`
            : `${server.transport.type}: ${server.transport.url}`;
        table.push([
          server.id,
          server.name,
          transportSummary,
          server.tags.join(", ") || chalk.dim("(none)"),
          `${server.healthCheckIntervalMs}ms`
        ]);
      }
      console.log(table.toString());
    } finally {
      store.close();
    }
  })();
}
