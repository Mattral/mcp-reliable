import { describe, expect, it } from "vitest";
import { extractErrorMessage } from "../src/error-message.js";

describe("extractErrorMessage", () => {
  it("uses the protocol-level error message when present", () => {
    const message = { error: { code: -32601, message: "Method not found" } };
    expect(extractErrorMessage(message)).toBe("Method not found");
  });

  it("extracts the real error text from a tool-level isError result's content", () => {
    const message = {
      result: { isError: true, content: [{ type: "text", text: "simulated transient failure" }] }
    };
    expect(extractErrorMessage(message)).toBe("simulated transient failure");
  });

  it("joins multiple text blocks", () => {
    const message = {
      result: {
        isError: true,
        content: [
          { type: "text", text: "rate limit exceeded." },
          { type: "text", text: "retry after 30s." }
        ]
      }
    };
    expect(extractErrorMessage(message)).toBe("rate limit exceeded. retry after 30s.");
  });

  it("ignores non-text content blocks when extracting text", () => {
    const message = {
      result: {
        isError: true,
        content: [
          { type: "image", data: "base64...", mimeType: "image/png" },
          { type: "text", text: "failed to process image" }
        ]
      }
    };
    expect(extractErrorMessage(message)).toBe("failed to process image");
  });

  it("falls back to a generic placeholder when there's no error object and no text content", () => {
    const message = { result: { isError: true, content: [{ type: "image", data: "..." }] } };
    expect(extractErrorMessage(message)).toContain("no error text or content");
  });

  it("falls back to a generic placeholder when result has no content at all", () => {
    const message = { result: { isError: true } };
    expect(extractErrorMessage(message)).toContain("no error text or content");
  });

  it("prefers the protocol-level error even if result also happens to be present", () => {
    const message = {
      error: { code: -32000, message: "transport failure" },
      result: { isError: true, content: [{ type: "text", text: "should not be used" }] }
    };
    expect(extractErrorMessage(message)).toBe("transport failure");
  });
});
