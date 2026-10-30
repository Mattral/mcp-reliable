import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  computeSchemaFingerprint,
  detectSchemaDrift,
  type DriftEvent,
  type Execution,
  type Server,
  type Tool
} from "@mattral/core";
import type { ReliabilityStore } from "@mattral/storage";
import { createClientTransport } from "./transport-factory.js";
import { VERSION } from "./version.js";

export interface HealthCheckResult {
  serverId: string;
  reachable: boolean;
  latencyMs: number;
  toolCount: number;
  driftEvents: DriftEvent[];
  error?: string;
}

export interface HealthCheckerOptions {
  store: ReliabilityStore;
  /** Client identity advertised to monitored servers during the MCP handshake. */
  clientInfo?: { name: string; version: string };
  /** Timeout for the initialize handshake and the tools/list round trip. Default 10s. */
  timeoutMs?: number;
}

/** Reserved pseudo tool-name under which health-check round trips are recorded. */
export const HEALTH_CHECK_TOOL_NAME = "__health_check__";

/**
 * Performs a single, side-effect-free health check against a server:
 * connects, completes the MCP `initialize` handshake, calls `tools/list`,
 * and disconnects.
 *
 * This deliberately never calls a tool. Per the project's operational
 * principles (spec section 11 / docs/architecture.md#security), a
 * monitoring tool must not exercise side effects on a server it doesn't
 * have explicit consent to invoke. Observing *real* tool calls — the ones a
 * live agent chose to make — is the job of {@link StdioProxyCollector}
 * instead, where mcp-reliable never originates the call itself.
 */
export class HealthChecker {
  private readonly store: ReliabilityStore;
  private readonly clientInfo: { name: string; version: string };
  private readonly timeoutMs: number;

  constructor(options: HealthCheckerOptions) {
    this.store = options.store;
    this.clientInfo = options.clientInfo ?? { name: "mcp-reliable", version: VERSION };
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async check(server: Server): Promise<HealthCheckResult> {
    const start = performance.now();
    const now = Date.now();
    const client = new Client(this.clientInfo, { capabilities: {} });
    const transport = createClientTransport(server.transport);
    const driftEvents: DriftEvent[] = [];

    try {
      await client.connect(transport, { timeout: this.timeoutMs });
      const { tools } = await client.listTools(undefined, { timeout: this.timeoutMs });
      const latencyMs = performance.now() - start;

      for (const tool of tools) {
        const fingerprint = computeSchemaFingerprint(tool.inputSchema);
        const existing = this.store.getTool(server.id, tool.name);

        const drift = detectSchemaDrift({
          serverId: server.id,
          toolName: tool.name,
          previousFingerprint: existing?.schemaFingerprint,
          currentFingerprint: fingerprint,
          now
        });
        if (drift) {
          this.store.recordDriftEvent(drift);
          driftEvents.push(drift);
        }

        const toolRecord: Tool = {
          id: existing?.id ?? randomUUID(),
          serverId: server.id,
          name: tool.name,
          description: tool.description,
          schemaFingerprint: fingerprint,
          inputSchema: tool.inputSchema,
          firstSeenAt: existing?.firstSeenAt ?? now,
          lastSeenAt: now
        };
        this.store.upsertTool(toolRecord);
      }

      this.recordHealthCheckExecution(server.id, now, latencyMs, true);

      return { serverId: server.id, reachable: true, latencyMs, toolCount: tools.length, driftEvents };
    } catch (error) {
      const latencyMs = performance.now() - start;
      const message = error instanceof Error ? error.message : String(error);
      this.recordHealthCheckExecution(server.id, now, latencyMs, false, message);
      return { serverId: server.id, reachable: false, latencyMs, toolCount: 0, driftEvents, error: message };
    } finally {
      await client.close().catch(() => {
        // Best-effort: the connection may already be dead if the check failed.
      });
    }
  }

  private recordHealthCheckExecution(
    serverId: string,
    startedAt: number,
    durationMs: number,
    success: boolean,
    errorMessage?: string
  ): void {
    const execution: Execution = {
      id: randomUUID(),
      serverId,
      toolName: HEALTH_CHECK_TOOL_NAME,
      startedAt,
      durationMs,
      success,
      errorMessage,
      source: "health-check"
    };
    this.store.recordExecution(execution);
  }
}
