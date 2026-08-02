import type { JsonRpcMessage } from "./json-rpc-framer.js";

/**
 * Extracts a human-readable error message from a raw MCP `tools/call`
 * response, for both kinds of failure the protocol allows:
 *
 * - **Protocol-level failures**: the JSON-RPC response has an `error`
 *   object (e.g. a malformed request, a transport-level failure). Its
 *   `.message` is already the right text — nothing to unwrap.
 * - **Tool-level failures**: the JSON-RPC response is a normal `result`
 *   with `isError: true`, and the actual, tool-specific error description
 *   lives in `result.content` as ordinary text blocks — this is the MCP
 *   spec's convention for a tool reporting its *own* failure without it
 *   being treated as a transport-level protocol error (this project's own
 *   reference server's `flaky` tool does exactly this).
 *
 * Before this function existed, every tool-level failure's real error
 * text was discarded in favor of one generic placeholder string,
 * regardless of what the tool actually said — the same underlying mistake
 * as the pre-`extractOutputPayload` output-shape bug (see
 * docs/decisions/0015-statistical-drift-detection.md): treating MCP's
 * `content` array as opaque instead of reading what's actually inside it.
 * See docs/decisions/0016-error-classification.md.
 *
 * Falls back to a generic placeholder only when there's truly no error
 * object and no text content to describe the failure at all.
 */
export function extractErrorMessage(message: JsonRpcMessage): string {
  if (message.error?.message) return message.error.message;

  const content = message.result?.content;
  if (Array.isArray(content)) {
    const texts = content
      .filter(
        (block): block is { type: string; text: string } =>
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string"
      )
      .map((block) => block.text);
    if (texts.length > 0) return texts.join(" ");
  }

  return "Tool call returned isError: true, with no error text or content to describe why.";
}
