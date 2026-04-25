import { describe, expect, it } from "vitest";
import { resolveTransport, type AddServerOptions } from "../src/commands/add-server.js";

function options(overrides: Partial<AddServerOptions> = {}): AddServerOptions {
  return { name: "test", ...overrides };
}

describe("resolveTransport", () => {
  it("parses a quoted --stdio string into command + args", () => {
    const transport = resolveTransport(options({ stdio: "npx my-mcp-server --flag" }), []);
    expect(transport).toEqual({ type: "stdio", command: "npx", args: ["my-mcp-server", "--flag"] });
  });

  it("falls back to the positional command array when --stdio is a bare flag", () => {
    const transport = resolveTransport(options({ stdio: true }), ["npx", "my-mcp-server", "--flag"]);
    expect(transport).toEqual({ type: "stdio", command: "npx", args: ["my-mcp-server", "--flag"] });
  });

  it("builds an sse transport", () => {
    const transport = resolveTransport(options({ sse: "https://example.com/sse" }), []);
    expect(transport).toEqual({ type: "sse", url: "https://example.com/sse" });
  });

  it("builds an http transport", () => {
    const transport = resolveTransport(options({ http: "https://example.com/mcp" }), []);
    expect(transport).toEqual({ type: "http", url: "https://example.com/mcp" });
  });

  it("throws when no transport is specified", () => {
    expect(() => resolveTransport(options(), [])).toThrow(/No transport specified/);
  });

  it("throws when more than one transport is specified", () => {
    expect(() =>
      resolveTransport(options({ stdio: "npx a", sse: "https://example.com" }), [])
    ).toThrow(/only one transport/);
  });

  it("throws a helpful error when --stdio has no command and no positional args", () => {
    expect(() => resolveTransport(options({ stdio: true }), [])).toThrow(/needs a command/);
  });
});
