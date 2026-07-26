import { driftEventToAlert } from "@mattral/core";
import { StdioProxyCollector } from "@mattral/collector";
import { createNotifier } from "@mattral/notifier";
import { openStore } from "../config.js";
import { CliError } from "../errors.js";

export interface ProxyOptions {
  webhook?: string;
  slackWebhook?: string;
  db?: string;
}

/** How long to wait for in-flight webhook/Slack deliveries during shutdown before giving up and exiting anyway — a broken receiver should never hang the process indefinitely. */
const SHUTDOWN_NOTIFICATION_TIMEOUT_MS = 5000;

function awaitPendingNotifications(pending: readonly Promise<void>[]): Promise<void> {
  if (pending.length === 0) return Promise.resolve();
  return Promise.race([
    Promise.allSettled(pending).then(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_NOTIFICATION_TIMEOUT_MS))
  ]);
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
  const notifier = createNotifier({ webhookUrl: options.webhook, slackWebhookUrl: options.slackWebhook });

  // Notifications fire without being awaited *inside* onDrift (a callback
  // fired mid-message-forwarding must never block proxying on webhook
  // latency) — but they're tracked here and awaited (with a timeout) on
  // every shutdown path below, natural or signal-driven. Fire-and-forget
  // for the life of a single callback is fine; fire-and-forget for the
  // life of the whole process risks losing a notification if the process
  // exits (Ctrl+C, the wrapped server exiting, an external process
  // manager killing this one, etc.) before an in-flight fetch finishes —
  // exactly what an actual test run of this feature caught during
  // development. See docs/decisions/0010-alerting-notifier-design.md.
  const pendingNotifications: Promise<void>[] = [];
  let shuttingDown = false;

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
    const registeredServer = server;

    process.stderr.write(`mcp-reliable proxy: wrapping "${[cmd, ...args].join(" ")}" as server "${serverId}"\n`);

    const collector = new StdioProxyCollector({
      serverId,
      store,
      command: cmd,
      args,
      cwd: process.cwd(),
      onDrift: (event) => {
        process.stderr.write(`mcp-reliable proxy: drift detected — ${event.description}\n`);
        if (!notifier) return;
        const alert = driftEventToAlert(event);
        store.recordAlert(alert);
        pendingNotifications.push(
          notifier.notify({ alert, server: registeredServer }).catch((error) => {
            process.stderr.write(
              `mcp-reliable proxy: notification delivery failed — ${error instanceof Error ? error.message : String(error)}\n`
            );
          })
        );
      }
    });

    // If this process is killed directly (Ctrl+C, an external process
    // manager, a client that just tears down the connection) rather than
    // the wrapped server exiting on its own, make sure the wrapped child
    // is actually terminated (not orphaned) and any in-flight
    // notifications get a real chance to finish before we do.
    const handleSignal = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      void (async () => {
        await collector.stop();
        await awaitPendingNotifications(pendingNotifications);
        store.close();
        process.exit(0);
      })();
    };
    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);

    const exitCode = await collector.start();
    if (!shuttingDown) {
      await awaitPendingNotifications(pendingNotifications);
      process.exitCode = exitCode ?? 0;
    }
  } catch (error) {
    const message = error instanceof CliError ? error.message : error instanceof Error ? error.message : String(error);
    process.stderr.write(`mcp-reliable proxy: ${message}\n`);
    process.exitCode = 1;
  } finally {
    if (!shuttingDown) store.close();
  }
}
