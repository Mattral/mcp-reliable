import { existsSync } from "node:fs";
import chalk from "chalk";
import { openStore, resolveDbPath } from "../config.js";
import { withFriendlyErrors } from "../errors.js";

export function runInit(options: { db?: string }): Promise<void> {
  return withFriendlyErrors(async () => {
    const dbPath = resolveDbPath(options.db);
    const alreadyExisted = existsSync(dbPath);

    const { store } = openStore({ dbPath: options.db });
    const serverCount = store.listServers().length;
    store.close();

    if (alreadyExisted) {
      console.log(chalk.green("✓") + ` Already initialized at ${chalk.dim(dbPath)}`);
      console.log(`  Tracking ${serverCount} registered server(s).`);
    } else {
      console.log(chalk.green("✓ mcp-reliable initialized") + ` at ${chalk.dim(dbPath)}`);
    }

    console.log();
    console.log("Next step — register a server to monitor:");
    console.log(chalk.cyan('  mcp-reliable add-server --name my-server --stdio -- npx my-mcp-server'));
  })();
}
