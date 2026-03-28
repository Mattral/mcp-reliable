import { describe, expect, it, vi } from "vitest";
import { JsonRpcFramer, serializeJsonRpc } from "../src/json-rpc-framer.js";

describe("JsonRpcFramer", () => {
  it("parses a single complete line delivered in one chunk", () => {
    const onMessage = vi.fn();
    const framer = new JsonRpcFramer(onMessage);
    framer.push('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0]?.[0]).toEqual({ jsonrpc: "2.0", id: 1, method: "ping" });
  });

  it("buffers a message split across multiple chunks", () => {
    const onMessage = vi.fn();
    const framer = new JsonRpcFramer(onMessage);
    framer.push('{"jsonrpc":"2.0","id"');
    expect(onMessage).not.toHaveBeenCalled();
    framer.push(':1,"method":"ping"}\n');
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it("parses multiple messages delivered in one chunk", () => {
    const onMessage = vi.fn();
    const framer = new JsonRpcFramer(onMessage);
    framer.push('{"id":1}\n{"id":2}\n{"id":3}\n');
    expect(onMessage).toHaveBeenCalledTimes(3);
    expect(onMessage.mock.calls.map((c) => c[0].id)).toEqual([1, 2, 3]);
  });

  it("ignores blank lines", () => {
    const onMessage = vi.fn();
    const framer = new JsonRpcFramer(onMessage);
    framer.push('{"id":1}\n\n\n{"id":2}\n');
    expect(onMessage).toHaveBeenCalledTimes(2);
  });

  it("routes malformed lines to onParseError instead of throwing", () => {
    const onMessage = vi.fn();
    const onParseError = vi.fn();
    const framer = new JsonRpcFramer(onMessage, onParseError);
    expect(() => framer.push("not json at all\n")).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();
    expect(onParseError).toHaveBeenCalledTimes(1);
    expect(onParseError.mock.calls[0]?.[0]).toBe("not json at all");
  });

  it("keeps an unterminated trailing partial line in the buffer across pushes", () => {
    const onMessage = vi.fn();
    const framer = new JsonRpcFramer(onMessage);
    framer.push('{"id":1}\n{"id":2}'); // no trailing newline on the second message
    expect(onMessage).toHaveBeenCalledTimes(1);
    framer.push("\n");
    expect(onMessage).toHaveBeenCalledTimes(2);
  });
});

describe("serializeJsonRpc", () => {
  it("appends exactly one trailing newline", () => {
    const wire = serializeJsonRpc({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(wire.endsWith("\n")).toBe(true);
    expect(wire.split("\n")).toHaveLength(2); // one JSON line + trailing empty string after split
    expect(JSON.parse(wire.trim())).toEqual({ jsonrpc: "2.0", id: 1, method: "ping" });
  });
});
