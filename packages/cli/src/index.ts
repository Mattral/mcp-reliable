#!/usr/bin/env node
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runAddServer } from "./commands/add-server.js";
import { runRemoveServer, runListServers } from "./commands/servers.js";
import { runMonitor } from "./commands/monitor.js";
import { runReport } from "./commands/report.js";
import { runProxy } from "./commands/proxy.js";
import { runMcp } from "./commands/mcp.js";

const program = new Command();

program
  .name("mcp-reliable")
  .description("Runtime observability and reliability platform for the Model Context Protocol ecosystem")
  .version("1.0.0");

program
  .command("init")
  .description("Set up local mcp-reliable state in the current directory")
  .option("--db <path>", "Path to the SQLite database (default: ./.mcp-reliable/data.sqlite)")
  .action((options) => runInit(options));

program
  .command("add-server")
  .description("Register an MCP server to monitor")
  .requiredOption("--name <name>", "A short, human-readable name for this server")
  .option("--stdio [command]", 'Use a stdio transport: either --stdio "npx my-server" or -- npx my-server --flag')
  .option("--sse <url>", "Use an SSE transport at this URL")
  .option("--http <url>", "Use a streamable HTTP transport at this URL")
  .option("--tag <tag>", "Tag this server (repeatable)", (value: string, previous: string[]) => [...previous, value], [] as string[])
  .option("--interval <ms>", "Health check interval in milliseconds", "60000")
  .option("--db <path>", "Path to the SQLite database")
  .argument("[command...]", "For --stdio without a value: the command and args to run, after --")
  .action((positionalCommand: string[], options) => runAddServer(options, positionalCommand));

program
  .command("remove-server")
  .description("Remove a registered server and its history")
  .argument("<id>", "The server id (see `mcp-reliable servers`)")
  .option("--db <path>", "Path to the SQLite database")
  .action((id: string, options) => runRemoveServer(id, options));

program
  .command("servers")
  .description("List registered servers")
  .option("--db <path>", "Path to the SQLite database")
  .action((options) => runListServers(options));

program
  .command("monitor")
  .description("Continuously health-check registered servers and show live status")
  .option("--server <id>", "Only monitor this server")
  .option("--once", "Run a single check and exit (useful for scripting/CI)")
  .option("--interval <ms>", "Polling interval in milliseconds", "30000")
  .option("--window <ms>", "Trailing window for health-degradation scoring, in milliseconds", "3600000")
  .option(
    "--timeout <ms>",
    "Connection timeout for each health check's initialize handshake and tools/list round trip, in milliseconds",
    "10000"
  )
  .option("--webhook <url>", "POST a JSON payload to this URL when an alert opens or resolves")
  .option("--slack-webhook <url>", "Post to this Slack incoming-webhook URL when an alert opens or resolves")
  .option("--db <path>", "Path to the SQLite database")
  .action((options) => runMonitor(options));

program
  .command("report")
  .description("Summarize reliability and drift over a time window")
  .option("--server <id>", "Only report on this server")
  .option("--last <duration>", 'Time window, e.g. "1h", "24h", "7d"', "24h")
  .option("--drift", "Include a detailed drift event listing")
  .option("--db <path>", "Path to the SQLite database")
  .action((options) => runReport(options));

program
  .command("proxy")
  .description("Wrap a real MCP server, transparently recording every tool call it handles")
  .argument("<server-id>", "An id to file this server's data under (created if new)")
  .argument("<command...>", "The real server's command and args, after --")
  .option("--webhook <url>", "POST a JSON payload to this URL when drift is detected in live traffic")
  .option("--slack-webhook <url>", "Post to this Slack incoming-webhook URL when drift is detected in live traffic")
  .option("--db <path>", "Path to the SQLite database")
  .action((serverId: string, command: string[], options) => runProxy(serverId, command, options));

program
  .command("mcp")
  .description("Run the agent-facing MCP interface over stdio (list_servers, get_server_health, list_drift_events, list_alerts, get_recommendation, list_recommendations)")
  .option("--db <path>", "Path to the SQLite database")
  .action((options) => runMcp(options));

program.parseAsync(process.argv);
