import { randomUUID } from "node:crypto";
import chalk from "chalk";
import Table from "cli-table3";
import type { Alert, DriftEvent, HealthDegradationThresholds, Server } from "@mattral/core";
import { DEFAULT_HEALTH_DEGRADATION_THRESHOLDS, detectHealthDegradation, driftEventToAlert } from "@mattral/core";
import { HealthChecker, type HealthCheckResult } from "@mattral/collector";
import type { ReliabilityStore } from "@mattral/storage";
import { createNotifier, type Notifier } from "@mattral/notifier";
import { openStore } from "../config.js";
import { CliError, withFriendlyErrors } from "../errors.js";
import { formatMs } from "../format.js";
import { buildServerReport } from "./report.js";

export interface MonitorOptions {
  server?: string;
  once?: boolean;
  interval?: string;
  /** Trailing window (ms) used to compute the health score checked for degradation. Default 1h. */
  window?: string;
  /** Connection timeout (ms) for each health check's initialize handshake and tools/list round trip. Default 10s. */
  timeout?: string;
  webhook?: string;
  slackWebhook?: string;
  db?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parses a CLI flag's string value as a positive number of milliseconds,
 * falling back to a default when the flag wasn't passed. `--interval` and
 * `--window` each did this inline until `--timeout` became a third call
 * site — per the "rule of three" this project applies to duplication (see
 * docs/decisions/0006-server-config-duplication.md), that's the trigger to
 * extract it, not before.
 */
export function parsePositiveMs(value: string | undefined, flagName: string, defaultMs: number): number {
  const ms = value === undefined ? defaultMs : Number(value);
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new CliError(`${flagName} must be a positive number of milliseconds, got "${value}".`);
  }
  return ms;
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

export interface AlertReconciliation {
  /** A newly opened alert this call produced, if any. */
  opened: Alert | null;
  /** Any previously-open alerts this call resolved. */
  resolved: Alert[];
}

/**
 * Reconciles a health check result against the `unreachable` alert for a
 * server: opens one if the server just went down, resolves it if the
 * server has come back. Kept idempotent — safe to call every tick. Returns
 * what changed so the caller can notify on both directions (an outage
 * *and* its recovery are both worth telling someone about).
 */
export function reconcileUnreachableAlert(
  store: ReliabilityStore,
  server: Server,
  result: HealthCheckResult
): AlertReconciliation {
  const openAlerts = store
    .listAlerts({ serverId: server.id, onlyUnresolved: true })
    .filter((a) => a.kind === "unreachable");

  if (!result.reachable && openAlerts.length === 0) {
    const alert: Alert = {
      id: randomUUID(),
      serverId: server.id,
      triggeredAt: Date.now(),
      severity: "critical",
      kind: "unreachable",
      message: result.error ? `Server unreachable: ${result.error}` : "Server unreachable"
    };
    store.recordAlert(alert);
    return { opened: alert, resolved: [] };
  }

  if (result.reachable && openAlerts.length > 0) {
    const resolvedAt = Date.now();
    for (const alert of openAlerts) {
      store.resolveAlert(alert.id, resolvedAt);
    }
    return { opened: null, resolved: openAlerts.map((a) => ({ ...a, resolvedAt })) };
  }

  return { opened: null, resolved: [] };
}

export interface HealthDegradationReconciliation extends AlertReconciliation {
  healthScore: ReturnType<typeof buildServerReport>["healthScore"];
}

/**
 * Computes a fresh, trailing-window health score for a server (via
 * `buildServerReport`, which also persists it — feeding the dashboard's
 * history chart as a side effect of monitoring, not just of `report`
 * runs), compares it against the previously recorded score, and opens or
 * resolves a `health-degradation` alert accordingly. Pairs with
 * `detectHealthDegradation` in `@mattral/core` the same way this
 * file's `reconcileUnreachableAlert` pairs with a raw reachability check —
 * see that function's docstring for why transition-only, band-based
 * alerting avoids re-alerting on every tick a server stays degraded.
 */
export function reconcileHealthDegradationAlert(
  store: ReliabilityStore,
  server: Server,
  windowMs: number,
  thresholds: HealthDegradationThresholds = DEFAULT_HEALTH_DEGRADATION_THRESHOLDS
): HealthDegradationReconciliation {
  const history = store.listHealthScores(server.id);
  const previousScore = history.length > 0 ? history[history.length - 1]?.score : undefined;

  const windowEnd = Date.now();
  const windowStart = windowEnd - windowMs;
  const report = buildServerReport(store, server, windowStart, windowEnd);

  if (!report.healthScore) {
    return { healthScore: undefined, opened: null, resolved: [] };
  }

  const opened = detectHealthDegradation(server.id, previousScore, report.healthScore, thresholds);
  if (opened) {
    store.recordAlert(opened);
  }

  const resolved: Alert[] = [];
  if (report.healthScore.score >= thresholds.warningBelow) {
    const openAlerts = store
      .listAlerts({ serverId: server.id, onlyUnresolved: true })
      .filter((a) => a.kind === "health-degradation");
    const resolvedAt = Date.now();
    for (const alert of openAlerts) {
      store.resolveAlert(alert.id, resolvedAt);
      resolved.push({ ...alert, resolvedAt });
    }
  }

  return { healthScore: report.healthScore, opened, resolved };
}

/** Converts and records an alert for every drift event a health check just found. Drift alerts have no "resolved" state — each represents a point-in-time detected change, like the underlying DriftEvent log itself. */
export function recordDriftAlerts(store: ReliabilityStore, driftEvents: readonly DriftEvent[]): Alert[] {
  const alerts = driftEvents.map((event) => driftEventToAlert(event));
  for (const alert of alerts) store.recordAlert(alert);
  return alerts;
}

/**
 * Delivers a notification without ever letting a delivery failure crash
 * the monitor loop — a broken webhook URL shouldn't stop mcp-reliable
 * from doing the actual monitoring. Failures are logged, not thrown.
 */
async function safeNotify(notifier: Notifier | null, alert: Alert, server: Server): Promise<void> {
  if (!notifier) return;
  try {
    await notifier.notify({ alert, server });
  } catch (error) {
    console.error(
      chalk.dim(`  (notification delivery failed: ${error instanceof Error ? error.message : String(error)})`)
    );
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

function printAlertLine(alert: Alert, server: Server, verb: "opened" | "resolved"): void {
  const color = verb === "resolved" ? chalk.green : alert.severity === "critical" ? chalk.red : chalk.yellow;
  const icon = verb === "resolved" ? "✓" : "⚠";
  console.log(color(`${icon} [${server.name}] ${alert.message} (${verb})`));
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

      const intervalMs = parsePositiveMs(options.interval, "--interval", 30_000);
      const degradationWindowMs = parsePositiveMs(options.window, "--window", 3_600_000);
      const timeoutMs = parsePositiveMs(options.timeout, "--timeout", 10_000);

      const notifier = createNotifier({ webhookUrl: options.webhook, slackWebhookUrl: options.slackWebhook });

      const checker = new HealthChecker({ store, timeoutMs });
      const results = new Map<string, HealthCheckResult>();

      while (true) {
        const pass = await runOneMonitorPass(servers, checker);
        const transitions: Array<{ alert: Alert; server: Server; verb: "opened" | "resolved" }> = [];

        for (const result of pass) {
          results.set(result.serverId, result);
          const server = servers.find((s) => s.id === result.serverId);
          if (!server) continue;

          const reachability = reconcileUnreachableAlert(store, server, result);
          if (reachability.opened) transitions.push({ alert: reachability.opened, server, verb: "opened" });
          for (const a of reachability.resolved) transitions.push({ alert: a, server, verb: "resolved" });

          const driftAlerts = recordDriftAlerts(store, result.driftEvents);
          for (const a of driftAlerts) transitions.push({ alert: a, server, verb: "opened" });

          const degradation = reconcileHealthDegradationAlert(store, server, degradationWindowMs);
          if (degradation.opened) transitions.push({ alert: degradation.opened, server, verb: "opened" });
          for (const a of degradation.resolved) transitions.push({ alert: a, server, verb: "resolved" });
        }

        if (!options.once) console.clear();
        console.log(chalk.bold(`mcp-reliable monitor  ${chalk.dim(new Date().toLocaleTimeString())}`));
        console.log(renderTable(servers, results));

        for (const { alert, server, verb } of transitions) {
          printAlertLine(alert, server, verb);
        }
        await Promise.all(transitions.map(({ alert, server }) => safeNotify(notifier, alert, server)));

        if (options.once) return;
        console.log(chalk.dim(`\nPolling every ${intervalMs}ms. Press Ctrl+C to stop.`));
        await sleep(intervalMs);
      }
    } finally {
      store.close();
    }
  })();
}
