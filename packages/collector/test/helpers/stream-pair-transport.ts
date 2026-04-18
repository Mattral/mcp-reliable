import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * A minimal MCP {@link Transport} backed by a writable stream (outgoing) and
 * a readable stream (incoming), framed as newline-delimited JSON — exactly
 * the wire format the stdio proxy collector speaks. Used in tests to drive
 * a real SDK `Client` against `StdioProxyCollector`'s `input`/`output`
 * stream options, so the integration tests exercise the actual MCP
 * handshake rather than hand-rolled JSON-RPC fixtures.
 */
export class StreamPairTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private buffer = "";

  constructor(
    private readonly outgoing: NodeJS.WritableStream,
    private readonly incoming: NodeJS.ReadableStream
  ) {}

  async start(): Promise<void> {
    this.incoming.on("data", (chunk: Buffer) => this.handleData(chunk));
    this.incoming.on("error", (error: Error) => this.onerror?.(error));
  }

  private handleData(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length === 0) continue;
      this.onmessage?.(JSON.parse(line) as JSONRPCMessage);
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.outgoing.write(JSON.stringify(message) + "\n");
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}
