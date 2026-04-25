import type { TransportConfig } from "@mcp-reliable/core";
import { openStore } from "../config.js";
import { CliError, withFriendlyErrors } from "../errors.js";
import { slugify, tokenizeShellLike } from "../text-utils.js";
import chalk from "chalk";

export interface AddServerOptions {
  name: string;
  stdio?: string | boolean;
  sse?: string;
  http?: string;
  tag?: string[];
  interval?: string;
  db?: string;
}

export function resolveTransport(options: AddServerOptions, positionalCommand: string[]): TransportConfig {
  const transportFlagCount = [options.stdio, options.sse, options.http].filter((v) => v !== undefined).length;
  if (transportFlagCount === 0) {
    throw new CliError(
      "No transport specified.",
      "Pass one of: --stdio, --sse <url>, or --http <url>."
    );
  }
  if (transportFlagCount > 1) {
    throw new CliError("Specify only one transport (--stdio, --sse, or --http), not several.");
  }

  if (options.stdio !== undefined) {
    let tokens: string[];
    if (typeof options.stdio === "string") {
      tokens = tokenizeShellLike(options.stdio);
    } else if (positionalCommand.length > 0) {
      tokens = positionalCommand;
    } else {
      throw new CliError(
        "`--stdio` needs a command to run.",
        'Use --stdio "npx my-mcp-server", or add-server ... -- npx my-mcp-server --flag'
      );
    }
    const [command, ...args] = tokens;
    if (!command) {
      throw new CliError("`--stdio` needs a non-empty command.");
    }
    return { type: "stdio", command, args };
  }

  if (options.sse) {
    return { type: "sse", url: options.sse };
  }

  return { type: "http", url: options.http as string };
}

export function runAddServer(options: AddServerOptions, positionalCommand: string[]): Promise<void> {
  return withFriendlyErrors(async () => {
    const transport = resolveTransport(options, positionalCommand);
    const interval = options.interval ? Number(options.interval) : 60_000;
    if (!Number.isFinite(interval) || interval <= 0) {
      throw new CliError(`--interval must be a positive number of milliseconds, got "${options.interval}".`);
    }

    const { store, dbPath } = openStore({ dbPath: options.db });
    try {
      const id = slugify(options.name);
      const existing = store.getServer(id);
      if (existing) {
        throw new CliError(
          `A server named "${options.name}" (id: ${id}) is already registered.`,
          `Remove it first with: mcp-reliable remove-server ${id}`
        );
      }

      store.upsertServer({
        id,
        name: options.name,
        transport,
        tags: options.tag ?? [],
        createdAt: Date.now(),
        healthCheckIntervalMs: interval
      });

      console.log(chalk.green("✓") + ` Registered server "${options.name}" (id: ${chalk.bold(id)})`);
      console.log(`  Transport: ${describeTransport(transport)}`);
      console.log(`  Data: ${chalk.dim(dbPath)}`);
      console.log();
      console.log("Try it now:");
      console.log(chalk.cyan(`  mcp-reliable monitor --server ${id} --once`));
    } finally {
      store.close();
    }
  })();
}

function describeTransport(transport: TransportConfig): string {
  switch (transport.type) {
    case "stdio":
      return `stdio (${[transport.command, ...(transport.args ?? [])].join(" ")})`;
    case "sse":
      return `sse (${transport.url})`;
    case "http":
      return `http (${transport.url})`;
  }
}
