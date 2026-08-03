/**
 * Extracts the "meaningful" structured payload from a raw MCP
 * `tools/call` result, for output-shape drift detection to actually be
 * useful against it.
 *
 * Naively hashing `result.content` itself is close to useless for the
 * extremely common case where a tool returns its real structured data as
 * JSON text inside a single content block — `content: [{ type: "text",
 * text: "{...}" }]` has the exact same `[{type, text}]` shape whether the
 * embedded JSON is `{"message": "..."}` or `{"echoed": "...", "respondedAt":
 * "..."}`. A structural hash of the wrapper alone would never notice the
 * tool's actual output changed underneath it — this is exactly what this
 * project's own reference server does (see
 * `examples/reference-mcp-server/src/index.ts`), and what a great many
 * real-world MCP tools do too, for any tool that doesn't declare a formal
 * `outputSchema`. This function unwraps that, so what gets fingerprinted
 * is the real payload, not MCP's transport-level envelope around it.
 *
 * Precedence:
 * 1. `structuredContent`, if the tool declared an output schema and the
 *    SDK populated it — already a real object, nothing to unwrap.
 * 2. A single text content block that parses as JSON — the common
 *    "structured data serialized as text" convention.
 * 3. Otherwise, the raw `content` array as-is — still useful: catches a
 *    tool switching between text/image/resource blocks, or adding/
 *    removing blocks, even without parseable JSON inside them.
 * 4. If there's no `content` or `structuredContent` at all, the raw
 *    result object, matching how this was computed before this function
 *    existed (see docs/decisions/0015-statistical-drift-detection.md).
 */
export function extractOutputPayload(result: unknown): unknown {
  if (result === null || typeof result !== "object") return result;
  const r = result as { structuredContent?: unknown; content?: unknown };

  if (r.structuredContent !== undefined) return r.structuredContent;

  if (Array.isArray(r.content)) {
    if (r.content.length === 1) {
      const block = r.content[0] as { type?: string; text?: string };
      if (block?.type === "text" && typeof block.text === "string") {
        try {
          return JSON.parse(block.text);
        } catch {
          // Not JSON - a genuine plain-text result. Fall through to
          // hashing the content array itself.
        }
      }
    }
    return r.content;
  }

  return result;
}
