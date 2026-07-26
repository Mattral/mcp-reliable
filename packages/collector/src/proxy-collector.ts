import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  computeOutputSignature,
  computeSchemaFingerprint,
  detectSchemaDrift,
  type DriftEvent,
  type Execution,
  type Tool
} from "@mattral/core";
import type { ReliabilityStore } from "@mattral/storage";
import { JsonRpcFramer, type JsonRpcMessage } from "./json-rpc-framer.js";

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
  private child: ChildProcess | undefined;
  private readonly pendingCalls = new Map<string | number, PendingCall>();
  private readonly pendingListRequests = new Set<string | number>();

  constructor(options: StdioProxyCollectorOptions) {
    this.options = options;
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
    const durationMs = Date.now() - pending.startedAt;
    const isError = Boolean(message.error) || Boolean(message.result?.isError);
    const outputBytes =
      message.result !== undefined ? Buffer.byteLength(JSON.stringify(message.result), "utf8") : undefined;
    const outputSignature =
      !isError && message.result !== undefined
        ? computeOutputSignature(message.result.content ?? message.result)
        : undefined;

    const execution: Execution = {
      id: randomUUID(),
      serverId: this.options.serverId,
      toolName: pending.toolName,
      startedAt: pending.startedAt,
      durationMs,
      success: !isError,
      errorMessage: isError ? message.error?.message ?? "Tool call returned isError: true" : undefined,
      outputSignature,
      inputBytes: pending.inputBytes,
      outputBytes,
      source: "proxy"
    };

    this.options.store.recordExecution(execution);
    this.options.onExecution?.(execution);
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
        this.options.store.recordDriftEvent(drift);
        this.options.onDrift?.(drift);
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
