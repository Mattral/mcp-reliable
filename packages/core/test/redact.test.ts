import { describe, expect, it } from "vitest";
import { redactTransport, serializeServer } from "../src/redact.js";
import type { Server } from "../src/types.js";

describe("redactTransport", () => {
  it("redacts stdio env values but keeps the keys", () => {
    const redacted = redactTransport({
      type: "stdio",
      command: "npx",
      args: [],
      env: { API_KEY: "super-secret", DEBUG: "true" }
    });
    expect(redacted.type).toBe("stdio");
    if (redacted.type === "stdio") {
      expect(redacted.env).toEqual({ API_KEY: "***", DEBUG: "***" });
    }
  });

  it("leaves a stdio transport with no env untouched", () => {
    const transport = { type: "stdio" as const, command: "npx", args: ["thing"] };
    expect(redactTransport(transport)).toEqual(transport);
  });

  it("redacts sse header values but keeps the keys", () => {
    const redacted = redactTransport({
      type: "sse",
      url: "https://example.com/sse",
      headers: { Authorization: "Bearer xyz" }
    });
    if (redacted.type === "sse") {
      expect(redacted.headers).toEqual({ Authorization: "***" });
    }
  });

  it("redacts http header values but keeps the keys", () => {
    const redacted = redactTransport({
      type: "http",
      url: "https://example.com/mcp",
      headers: { "X-Api-Key": "abc123" }
    });
    if (redacted.type === "http") {
      expect(redacted.headers).toEqual({ "X-Api-Key": "***" });
    }
  });

  it("never leaks the original secret value anywhere in the result", () => {
    const redacted = redactTransport({
      type: "stdio",
      command: "npx",
      args: [],
      env: { TOKEN: "leak-me-not" }
    });
    expect(JSON.stringify(redacted)).not.toContain("leak-me-not");
  });
});

describe("serializeServer", () => {
  it("redacts the transport but preserves every other field", () => {
    const server: Server = {
      id: "srv-1",
      name: "my-server",
      transport: { type: "stdio", command: "npx", args: [], env: { SECRET: "shh" } },
      tags: ["demo"],
      createdAt: 1000,
      healthCheckIntervalMs: 60_000
    };
    const serialized = serializeServer(server);
    expect(serialized.id).toBe("srv-1");
    expect(serialized.name).toBe("my-server");
    expect(serialized.tags).toEqual(["demo"]);
    if (serialized.transport.type === "stdio") {
      expect(serialized.transport.env?.SECRET).toBe("***");
    }
  });
});
