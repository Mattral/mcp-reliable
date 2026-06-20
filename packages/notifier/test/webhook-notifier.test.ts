import { describe, expect, it, vi } from "vitest";
import type { Alert, Server } from "@mcp-reliable/core";
import { WebhookNotifier } from "../src/webhook-notifier.js";

function server(overrides: Partial<Server> = {}): Server {
  return {
    id: "srv-1",
    name: "my-server",
    transport: { type: "stdio", command: "npx", args: [], env: { SECRET: "shh" } },
    tags: [],
    createdAt: 0,
    healthCheckIntervalMs: 60_000,
    ...overrides
  };
}

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "alert-1",
    serverId: "srv-1",
    triggeredAt: 1000,
    severity: "critical",
    kind: "unreachable",
    message: "Server unreachable",
    ...overrides
  };
}

function fakeFetch(ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, statusText: ok ? "OK" : "Internal Server Error" });
}

describe("WebhookNotifier", () => {
  it("POSTs JSON to the configured URL", async () => {
    const fetchImpl = fakeFetch();
    const notifier = new WebhookNotifier({ url: "https://example.com/hook", fetchImpl: fetchImpl as unknown as typeof fetch });

    await notifier.notify({ alert: alert(), server: server() });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/hook");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body.event).toBe("mcp-reliable.alert");
    expect(body.alert.id).toBe("alert-1");
    expect(body.server).toEqual({ id: "srv-1", name: "my-server" });
  });

  it("never includes the full server object, only id and name", async () => {
    const fetchImpl = fakeFetch();
    const notifier = new WebhookNotifier({ url: "https://example.com/hook", fetchImpl: fetchImpl as unknown as typeof fetch });

    await notifier.notify({ alert: alert(), server: server() });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.server.transport).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("shh"); // the secret env value never appears anywhere in the payload
  });

  it("merges custom headers with Content-Type", async () => {
    const fetchImpl = fakeFetch();
    const notifier = new WebhookNotifier({
      url: "https://example.com/hook",
      headers: { Authorization: "Bearer xyz" },
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    await notifier.notify({ alert: alert(), server: server() });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer xyz");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("throws when the receiver responds with a non-ok status", async () => {
    const fetchImpl = fakeFetch(false, 500);
    const notifier = new WebhookNotifier({ url: "https://example.com/hook", fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(notifier.notify({ alert: alert(), server: server() })).rejects.toThrow(/500/);
  });
});
