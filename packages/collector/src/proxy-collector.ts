import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  computeOutputSignature,
  computeSchemaFingerprint,
  detectLatencyDrift,
  detectOutputShapeDrift,
  detectSchemaDrift,
  type DriftEvent,
  type Execution,
  type Tool
} from "@mattral/core";
import type { ReliabilityStore } from "@mattral/storage";
import { JsonRpcFramer, type JsonRpcMessage } from "./json-rpc-framer.js";
import { extractErrorMessage } from "./error-message.js";
import { extractOutputPayload } from "./output-payload.js";

export interface StdioProxyCollectorOptions {
  serverId: string;
  store: ReliabilityStore;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** Called for every recorded execution, in addition to persisting it to the store. */
  onExecution?: (execution: Execution) => void;
  /** Called whenever a drift event is detected and recorded. */
  onDrift?: (event: DriftEvent) => void;
  /** Stream carrying traffic FROM the real client (defaults to this process's stdin). */
  input?: NodeJS.ReadableStream;
  /** Stream carrying traffic TO the real client (defaults to this process's stdout). */
  output?: NodeJS.WritableStream;
  /**
   * How many executions of the *same tool* to accumulate between
   * window-based drift checks (output-shape and statistical/latency).
   * Unlike schema drift (an O(1) fingerprint compare, checked on every
   * `tools/list`), these compare whole windows of stored executions —
   * running that on literally every single call would mean a store query
   * plus a KS test per call on hot paths. Default 10: frequent enough that
   * drift is caught within a handful of seconds of typical traffic, cheap
   * enough not to matter. See docs/decisions/0015-statistical-drift-detection.md.
   */
  driftCheckIntervalCalls?: number;
  /**
   * Size of each of the two (baseline, recent) windows compared for
   * window-based drift. Default 20, matching `detectLatencyDrift`'s own
   * default `minSampleSize` — there's no point fetching a bigger window
   * than the detector needs.
   */
  driftWindowSize?: number;
}

interface PendingCall {
  toolName: string;
  startedAt: number;
  inputBytes: number;
}

interface ToolsListResult {
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
}

function isToolsListResult(value: unknown): value is ToolsListResult {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { tools?: unknown }).tools)
  );
}

/**
 * A transparent stdio proxy that sits between an MCP client (an agent) and
 * a real MCP server: it spawns the target server as a child process and
 * forwards every JSON-RPC message between the client and the child
 * unmodified, while recording an `Execution` for every `tools/call`
 * request/response pair it observes, and a `Tool` (with schema drift
 * detection) for every `tools/list` response.
 *
 * Because it only ever forwards traffic a real client originated, it
 * requires no special consent model of its own for the calls it observes —
 * see docs/architecture.md#collection-model. From the client's point of
 * view, this proxy *is* the MCP server: point your agent's server command
 * at `mcp-reliable proxy <server-id> -- <original command>` instead of the
 * original command directly.
 */
export class StdioProxyCollector {
  private readonly options: StdioProxyCollectorOptions;
  private readonly driftCheckIntervalCalls: number;
  private readonly driftWindowSize: number;
  private child: ChildProcess | undefined;
  private readonly pendingCalls = new Map<string | number, PendingCall>();
  private readonly pendingListRequests = new Set<string | number>();
  private readonly callCountByTool = new Map<string, number>();

  constructor(options: StdioProxyCollectorOptions) {
    this.options = options;
    this.driftCheckIntervalCalls = options.driftCheckIntervalCalls ?? 10;
    this.driftWindowSize = options.driftWindowSize ?? 20;
  }

  /**
   * Starts the child process and begins forwarding traffic. Resolves with
   * the child's exit code once it terminates, or rejects if it could not
   * be started at all (e.g. command not found).
   */
  start(): Promise<number | null> {
    const { command, args = [], env, cwd } = this.options;

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env: env ? { ...process.env, ...env } : process.env,
        cwd,
        stdio: ["pipe", "pipe", "inherit"]
      });
      this.child = child;

      const childStdin = child.stdin;
      const childStdout = child.stdout;
      if (!childStdin || !childStdout) {
        reject(new Error("Failed to open stdio pipes for the child MCP server process"));
        return;
      }

      const input = this.options.input ?? process.stdin;
      const output = this.options.output ?? process.stdout;

      // Downstream: messages FROM the client TO the child (requests, notifications).
      const downstreamFramer = new JsonRpcFramer(
        (message, raw) => {
          this.handleDownstreamMessage(message);
          childStdin.write(raw + "\n");
        },
        (raw) => childStdin.write(raw + "\n") // forward unparseable lines verbatim; never drop traffic
      );
      input.on("data", (chunk: Buffer) => downstreamFramer.push(chunk));
      input.on("end", () => child.kill());

      // Upstream: messages FROM the child TO the client (responses, notifications).
      const upstreamFramer = new JsonRpcFramer(
        (message, raw) => {
          this.handleUpstreamMessage(message);
          output.write(raw + "\n");
        },
        (raw) => output.write(raw + "\n")
      );
      childStdout.on("data", (chunk: Buffer) => upstreamFramer.push(chunk));

      child.on("error", (error) => reject(error));
      child.on("exit", (code) => resolve(code));
    });
  }

  async stop(): Promise<void> {
    this.child?.kill();
  }

  private handleDownstreamMessage(message: JsonRpcMessage): void {
    if (message.id === undefined) return;
    if (message.method === "tools/call") {
      const toolName = message.params?.name ?? "unknown";
      const inputBytes = Buffer.byteLength(JSON.stringify(message.params?.arguments ?? {}), "utf8");
      this.pendingCalls.set(message.id, { toolName, startedAt: Date.now(), inputBytes });
    } else if (message.method === "tools/list") {
      this.pendingListRequests.add(message.id);
    }
  }

  private handleUpstreamMessage(message: JsonRpcMessage): void {
    if (message.id === undefined) return;

    const pendingCall = this.pendingCalls.get(message.id);
    if (pendingCall) {
      this.pendingCalls.delete(message.id);
      this.recordCallExecution(pendingCall, message);
      return;
    }

    if (this.pendingListRequests.has(message.id)) {
      this.pendingListRequests.delete(message.id);
      if (isToolsListResult(message.result)) {
        this.recordToolsListResult(message.result);
      }
    }
  }

  private recordCallExecution(pending: PendingCall, message: JsonRpcMessage): void {
    const now = Date.now();
    const durationMs = now - pending.startedAt;
    const isError = Boolean(message.error) || Boolean(message.result?.isError);
    const outputBytes =
      message.result !== undefined ? Buffer.byteLength(JSON.stringify(message.result), "utf8") : undefined;
    const outputSignature =
      !isError && message.result !== undefined ? computeOutputSignature(extractOutputPayload(message.result)) : undefined;

    const execution: Execution = {
      id: randomUUID(),
      serverId: this.options.serverId,
      toolName: pending.toolName,
      startedAt: pending.startedAt,
      durationMs,
      success: !isError,
      errorMessage: isError ? extractErrorMessage(message) : undefined,
      outputSignature,
      inputBytes: pending.inputBytes,
      outputBytes,
      source: "proxy"
    };

    this.options.store.recordExecution(execution);
    this.options.onExecution?.(execution);
    this.maybeCheckWindowDrift(pending.toolName, now);
  }

  private recordDrift(drift: DriftEvent): void {
    this.options.store.recordDriftEvent(drift);
    this.options.onDrift?.(drift);
  }

  /**
   * Every `driftCheckIntervalCalls` calls to a given tool, pulls its last
   * two `driftWindowSize`-execution windows and runs the window-based
   * drift detectors (output-shape, latency) against them. Schema drift is
   * handled separately in `recordToolsListResult` — it's a per-fingerprint
   * compare, not a window comparison, so it runs on every `tools/list`
   * instead of being throttled here.
   */
  private maybeCheckWindowDrift(toolName: string, now: number): void {
    const count = (this.callCountByTool.get(toolName) ?? 0) + 1;
    this.callCountByTool.set(toolName, count);
    if (count % this.driftCheckIntervalCalls !== 0) return;

    const windowSize = this.driftWindowSize;
    // Most-recent-first (see SqliteStore#listExecutions): the first half is
    // the "recent" window, the second half the "baseline" it's compared
    // against.
    const executions = this.options.store.listExecutions({
      serverId: this.options.serverId,
      toolName,
      limit: windowSize * 2
    });
    if (executions.length < windowSize * 2) return;

    const recent = executions.slice(0, windowSize);
    const baseline = executions.slice(windowSize, windowSize * 2);

    const shapeDrift = detectOutputShapeDrift({
      serverId: this.options.serverId,
      toolName,
      baseline,
      recent,
      now
    });
    if (shapeDrift) this.recordDrift(shapeDrift);

    const latencyDrift = detectLatencyDrift({
      serverId: this.options.serverId,
      toolName,
      baseline,
      recent,
      now
    });
    if (latencyDrift) this.recordDrift(latencyDrift);
  }

  private recordToolsListResult(result: ToolsListResult): void {
    const now = Date.now();
    for (const tool of result.tools) {
      if (typeof tool.name !== "string") continue;

      const fingerprint = computeSchemaFingerprint(tool.inputSchema);
      const existing = this.options.store.getTool(this.options.serverId, tool.name);

      const drift = detectSchemaDrift({
        serverId: this.options.serverId,
        toolName: tool.name,
        previousFingerprint: existing?.schemaFingerprint,
        currentFingerprint: fingerprint,
        now
      });
      if (drift) {
        this.recordDrift(drift);
      }

      const toolRecord: Tool = {
        id: existing?.id ?? randomUUID(),
        serverId: this.options.serverId,
        name: tool.name,
        description: tool.description,
        schemaFingerprint: fingerprint,
        inputSchema: tool.inputSchema,
        firstSeenAt: existing?.firstSeenAt ?? now,
        lastSeenAt: now
      };
      this.options.store.upsertTool(toolRecord);
    }
  }
}
