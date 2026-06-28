import type { Server, TransportConfig } from "./types.js";

const REDACTED = "***";

/**
 * Redacts secret-shaped fields (env values, header values) from a
 * transport config before it ever leaves the process — to the REST API,
 * the agent-facing MCP interface, or anywhere else. Keys are kept
 * (useful for debugging "is FOO_API_KEY set at all") but values are not,
 * since server registrations routinely carry API keys in `env`/`headers`
 * and any of those consumers may be a less-trusted context than the local
 * SQLite file itself — a REST API that may be exposed beyond localhost, or
 * an LLM-driven agent whose reasoning/output could end up echoed
 * somewhere it shouldn't.
 *
 * Lives in `core` (not `server`, where it originated) because it's pure
 * data transformation with no I/O, and by the time a third consumer
 * needed it (the agent-facing MCP interface, alongside the REST API),
 * duplicating it further stopped being the right call — see
 * `decisions/0006-server-config-duplication.md`'s "rule of three."
 */
export function redactTransport(transport: TransportConfig): TransportConfig {
  if (transport.type === "stdio" && transport.env) {
    return { ...transport, env: Object.fromEntries(Object.keys(transport.env).map((k) => [k, REDACTED])) };
  }
  if ((transport.type === "sse" || transport.type === "http") && transport.headers) {
    return { ...transport, headers: Object.fromEntries(Object.keys(transport.headers).map((k) => [k, REDACTED])) };
  }
  return transport;
}

export function serializeServer(server: Server): Server {
  return { ...server, transport: redactTransport(server.transport) };
}
