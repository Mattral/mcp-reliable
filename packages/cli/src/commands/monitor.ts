import { randomUUID } from "node:crypto";
import chalk from "chalk";
import Table from "cli-table3";
import type { Server } from "@mcp-reliable/core";
import { HealthChecker, type HealthCheckResult } from "@mcp-reliable/collector";
import type { ReliabilityStore } from "@mcp-reliable/storage";
import { openStore } from "../config.js";
import { CliError, withFriendlyErrors } from "../errors.js";
import { formatMs } from "../format.js";

export interface MonitorOptions {
  server?: string;
  once?: boolean;
  interval?: string;
  db?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs one health-check pass over the given servers and returns the
 * results. Exported separately from the polling loop so it's independently
 * testable without needing to fake timers or terminal rendering.
 */
export async function runOneMonitorPass(
  servers: Server[],
  checker: HealthChecker
): Promise<HealthCheckResult[]> {
  return Promise.all(servers.map((server) => checker.check(server)));
}

/**
 * Reconciles a health check result against the `unreachable` alert for a
 * server: opens one if the server just went down, resolves it if the
 * server has come back. Kept idempotent — safe to call every tick.
 */
export function reconcileUnreachableAlert(store: ReliabilityStore, server: Server, result: HealthCheckResult): void {
  const openAlerts = store.listAlerts({ serverId: server.id, onlyUnresolved: true }).filter(
    (a) => a.kind === "unreachable"
  );

  if (!result.reachable && openAlerts.length === 0) {
    store.recordAlert({
      id: randomUUID(),
      serverId: server.id,
      triggeredAt: Date.now(),
      severity: "critical",
      kind: "unreachable",
      message: result.error ? `Server unreachable: ${result.error}` : "Server unreachable"
    });
  } else if (result.reachable && openAlerts.length > 0) {
    for (const alert of openAlerts) {
      store.resolveAlert(alert.id, Date.now());
    }
  }
}

function renderTable(servers: Server[], results: Map<string, HealthCheckResult>): string {
  const table = new Table({ head: ["Server", "Status", "Latency", "Tools", "Drift"] });
  for (const server of servers) {
    const result = results.get(server.id);
    if (!result) {
      table.push([server.name, chalk.dim("pending…"), "-", "-", "-"]);
      continue;
    }
    const status = result.reachable ? chalk.green("● reachable") : chalk.red("● unreachable");
    const drift = result.driftEvents.length > 0 ? chalk.red(`${result.driftEvents.length} new`) : chalk.dim("none");
    table.push([server.name, status, formatMs(result.latencyMs), String(result.toolCount), drift]);
  }
  return table.toString();
}

export function runMonitor(options: MonitorOptions): Promise<void> {
  return withFriendlyErrors(async () => {
    const { store } = openStore({ dbPath: options.db });
    try {
      const allServers = store.listServers();
      const servers = options.server ? allServers.filter((s) => s.id === options.server) : allServers;

      if (options.server && servers.length === 0) {
        throw new CliError(`No server registered with id "${options.server}".`, "Run `mcp-reliable servers` to list known servers.");
      }
      if (servers.length === 0) {
        throw new CliError(
          "No servers registered yet.",
          "Register one with: mcp-reliable add-server --name my-server --stdio -- npx my-mcp-server"
        );
      }

      const intervalMs = options.interval ? Number(options.interval) : 30_000;
      if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
        throw new CliError(`--interval must be a positive number of milliseconds, got "${options.interval}".`);
      }

      const checker = new HealthChecker({ store });
      const results = new Map<string, HealthCheckResult>();

      while (true) {
        const pass = await runOneMonitorPass(servers, checker);
        for (const result of pass) {
          results.set(result.serverId, result);
          const server = servers.find((s) => s.id === result.serverId);
          if (server) reconcileUnreachableAlert(store, server, result);
        }

        if (!options.once) console.clear();
        console.log(chalk.bold(`mcp-reliable monitor  ${chalk.dim(new Date().toLocaleTimeString())}`));
        console.log(renderTable(servers, results));

        for (const result of pass) {
          for (const drift of result.driftEvents) {
            console.log(chalk.yellow(`⚠ ${drift.description} (severity: ${drift.severity})`));
          }
        }

        if (options.once) return;
        console.log(chalk.dim(`\nPolling every ${intervalMs}ms. Press Ctrl+C to stop.`));
        await sleep(intervalMs);
      }
    } finally {
      store.close();
    }
  })();
}
