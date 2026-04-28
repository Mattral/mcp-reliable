import ora from "ora";
import chalk from "chalk";
import { computeHealthScore, type Server } from "@mcp-reliable/core";
import { HEALTH_CHECK_TOOL_NAME } from "@mcp-reliable/collector";
import type { ReliabilityStore } from "@mcp-reliable/storage";
import { openStore } from "../config.js";
import { CliError, withFriendlyErrors } from "../errors.js";
import { formatMs, formatPercent, formatScore, formatSeverity, parseDuration } from "../format.js";

export interface ReportOptions {
  server?: string;
  last?: string;
  drift?: boolean;
  db?: string;
}

export interface ServerReport {
  server: Server;
  windowStart: number;
  windowEnd: number;
  reachabilityRate: number | undefined; // undefined = no health checks recorded in window
  healthScore: ReturnType<typeof computeHealthScore> | undefined; // undefined = no live tool traffic in window
}

/**
 * Builds a report for a single server: reachability (from health-check
 * executions) and a tool health score (from real proxy-observed traffic),
 * kept deliberately separate — see docs/architecture.md#health-vs-reachability
 * for why a server can be "reachable" with no meaningful tool health score
 * yet (nobody has used it through the proxy), or vice versa.
 */
export function buildServerReport(
  store: ReliabilityStore,
  server: Server,
  windowStart: number,
  windowEnd: number
): ServerReport {
  const healthCheckExecutions = store.listExecutions({
    serverId: server.id,
    toolName: HEALTH_CHECK_TOOL_NAME,
    since: windowStart,
    until: windowEnd
  });
  const reachabilityRate =
    healthCheckExecutions.length > 0
      ? healthCheckExecutions.filter((e) => e.success).length / healthCheckExecutions.length
      : undefined;

  const proxyExecutions = store
    .listExecutions({ serverId: server.id, since: windowStart, until: windowEnd, limit: 10_000 })
    .filter((e) => e.source === "proxy");

  const driftEvents = store.listDriftEvents({ serverId: server.id, since: windowStart });

  const healthScore =
    proxyExecutions.length > 0
      ? computeHealthScore({
          serverId: server.id,
          windowStart,
          windowEnd,
          executions: proxyExecutions,
          driftEvents
        })
      : undefined;

  if (healthScore) store.recordHealthScore(healthScore);

  return { server, windowStart, windowEnd, reachabilityRate, healthScore };
}

function printReport(report: ServerReport, showDrift: boolean, store: ReliabilityStore): void {
  console.log();
  console.log(chalk.bold(report.server.name) + chalk.dim(` (${report.server.id})`));

  if (report.reachabilityRate === undefined) {
    console.log(`  Reachability: ${chalk.dim("no health checks recorded in this window")}`);
  } else {
    console.log(`  Reachability: ${formatPercent(report.reachabilityRate)}`);
  }

  if (!report.healthScore) {
    console.log(`  Tool health: ${chalk.dim("no live tool traffic observed in this window")}`);
    console.log(chalk.dim("    (run this server through `mcp-reliable proxy` to collect real usage data)"));
  } else {
    const hs = report.healthScore;
    console.log(`  Tool health score: ${formatScore(hs.score)} / 100  (${hs.sampleCount} calls)`);
    console.log(`  Success rate: ${formatPercent(hs.successRate)}`);
    console.log(`  Latency: p50 ${formatMs(hs.p50LatencyMs)}, p95 ${formatMs(hs.p95LatencyMs)}`);
  }

  if (showDrift) {
    const driftEvents = store.listDriftEvents({ serverId: report.server.id, since: report.windowStart });
    if (driftEvents.length === 0) {
      console.log(`  Drift: ${chalk.dim("none detected in this window")}`);
    } else {
      console.log(`  Drift (${driftEvents.length}):`);
      for (const event of driftEvents) {
        const when = new Date(event.detectedAt).toLocaleString();
        console.log(`    [${formatSeverity(event.severity)}] ${event.description} — ${chalk.dim(when)}`);
      }
    }
  }
}

export function runReport(options: ReportOptions): Promise<void> {
  return withFriendlyErrors(async () => {
    const windowMs = parseDuration(options.last ?? "24h");
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

      const spinner = ora(`Analyzing ${servers.length} server(s) over the last ${options.last ?? "24h"}…`).start();
      const windowEnd = Date.now();
      const windowStart = windowEnd - windowMs;
      const reports = servers.map((server) => buildServerReport(store, server, windowStart, windowEnd));
      spinner.succeed(`Analyzed ${servers.length} server(s) over the last ${options.last ?? "24h"}`);

      for (const report of reports) {
        printReport(report, Boolean(options.drift), store);
      }
      console.log();
    } finally {
      store.close();
    }
  })();
}
