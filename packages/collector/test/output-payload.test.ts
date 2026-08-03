import { describe, expect, it } from "vitest";
import { extractOutputPayload } from "../src/output-payload.js";

describe("extractOutputPayload", () => {
  it("prefers structuredContent when present", () => {
    const result = {
      structuredContent: { count: 3 },
      content: [{ type: "text", text: "irrelevant" }]
    };
    expect(extractOutputPayload(result)).toEqual({ count: 3 });
  });

  it("parses a single JSON-text content block into its real structured shape", () => {
    const result = { content: [{ type: "text", text: JSON.stringify({ message: "hi", count: 2 }) }] };
    expect(extractOutputPayload(result)).toEqual({ message: "hi", count: 2 });
  });

  it("distinguishes two different embedded JSON shapes that would otherwise look identical", () => {
    // This is the exact bug this function fixes: without unwrapping, both
    // of these have the identical outer shape `[{type, text}]`.
    const v1 = { content: [{ type: "text", text: JSON.stringify({ message: "hi" }) }] };
    const v2 = { content: [{ type: "text", text: JSON.stringify({ echoed: "hi", respondedAt: "2026-01-01" }) }] };
    expect(extractOutputPayload(v1)).not.toEqual(extractOutputPayload(v2));
  });

  it("falls back to the content array for plain (non-JSON) text", () => {
    const result = { content: [{ type: "text", text: "just a plain sentence, not JSON" }] };
    expect(extractOutputPayload(result)).toEqual(result.content);
  });

  it("falls back to the content array for multi-block results", () => {
    const result = {
      content: [
        { type: "text", text: "here's an image:" },
        { type: "image", data: "base64...", mimeType: "image/png" }
      ]
    };
    expect(extractOutputPayload(result)).toEqual(result.content);
  });

  it("falls back to the raw result when there's no content or structuredContent at all", () => {
    const result = { someOtherField: 42 };
    expect(extractOutputPayload(result)).toEqual(result);
  });

  it("passes through non-object results (e.g. null, primitives) unchanged", () => {
    expect(extractOutputPayload(null)).toBeNull();
    expect(extractOutputPayload("plain string")).toBe("plain string");
    expect(extractOutputPayload(42)).toBe(42);
  });
});
