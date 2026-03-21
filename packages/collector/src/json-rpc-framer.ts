/**
 * A minimal JSON-RPC 2.0 message shape, loosely typed on purpose: the proxy
 * only needs to inspect `id`, `method`, `result`, and `error` — it forwards
 * every other field verbatim without validating them against the full MCP
 * type definitions (that validation is the target server's job).
 */
export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: { name?: string; arguments?: unknown; [key: string]: unknown };
  result?: { isError?: boolean; content?: unknown; [key: string]: unknown };
  error?: { code: number; message: string; [key: string]: unknown };
  [key: string]: unknown;
}

/**
 * The MCP stdio transport frames JSON-RPC messages as one JSON object per
 * line (newline-delimited), per the MCP specification. This class buffers
 * partial reads from a stream and yields fully-parsed messages as they
 * become available — the same approach the official SDK's internal
 * ReadBuffer uses, reimplemented here so the proxy collector can stay a
 * thin, dependency-light pass-through rather than depending on SDK
 * internals that aren't part of its public API.
 *
 * Malformed lines are surfaced via the `onParseError` callback rather than
 * thrown, since a single bad line should not take down the whole proxy —
 * it is forwarded to the child/downstream as raw bytes regardless (the
 * proxy's job is to observe traffic, not to enforce protocol correctness).
 */
export class JsonRpcFramer {
  private buffer = "";

  constructor(
    private readonly onMessage: (message: JsonRpcMessage, raw: string) => void,
    private readonly onParseError?: (raw: string, error: unknown) => void
  ) {}

  push(chunk: Buffer | string): void {
    this.buffer += chunk.toString("utf8");
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        const message = JSON.parse(trimmed) as JsonRpcMessage;
        this.onMessage(message, line);
      } catch (error) {
        this.onParseError?.(line, error);
      }
    }
  }
}

/** Serializes a JSON-RPC message back to the newline-delimited wire format. */
export function serializeJsonRpc(message: JsonRpcMessage): string {
  return JSON.stringify(message) + "\n";
}
