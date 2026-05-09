import type { Server, TransportConfig } from "@mcp-reliable/core";

const REDACTED = "***";

/**
 * Redacts secret-shaped fields (env values, header values) from a transport
 * config before it ever leaves the process via the API. Keys are kept
 * (useful for debugging "is FOO_API_KEY set at all") but values are not —
 * this is a REST API that may eventually be exposed beyond localhost, and
 * server registrations routinely carry API keys in `env`.
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
