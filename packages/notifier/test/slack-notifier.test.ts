import { describe, expect, it, vi } from "vitest";
import type { Alert, Server } from "@mattral/core";
import { SlackNotifier } from "../src/slack-notifier.js";

function server(): Server {
  return {
    id: "srv-1",
    name: "payments-search",
    transport: { type: "stdio", command: "npx", args: [] },
    tags: [],
    createdAt: 0,
    healthCheckIntervalMs: 60_000
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

function fakeFetch() {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
}

describe("SlackNotifier", () => {
  it("sends a plain {text} payload to the webhook URL", async () => {
    const fetchImpl = fakeFetch();
    const notifier = new SlackNotifier({ webhookUrl: "https://hooks.slack.com/x", fetchImpl: fetchImpl as unknown as typeof fetch });

    await notifier.notify({ alert: alert(), server: server() });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.com/x");
    const body = JSON.parse(init.body as string);
    expect(typeof body.text).toBe("string");
  });

  it("includes the server name and alert message in the text", async () => {
    const fetchImpl = fakeFetch();
    const notifier = new SlackNotifier({ webhookUrl: "https://hooks.slack.com/x", fetchImpl: fetchImpl as unknown as typeof fetch });

    await notifier.notify({ alert: alert({ message: "Health score dropped to 40.0" }), server: server() });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.text).toContain("payments-search");
    expect(body.text).toContain("Health score dropped to 40.0");
  });

  it("distinguishes triggered vs resolved in the message", async () => {
    const fetchImpl = fakeFetch();
    const notifier = new SlackNotifier({ webhookUrl: "https://hooks.slack.com/x", fetchImpl: fetchImpl as unknown as typeof fetch });

    await notifier.notify({ alert: alert({ resolvedAt: undefined }), server: server() });
    const triggeredBody = JSON.parse((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(triggeredBody.text).toContain("triggered");

    await notifier.notify({ alert: alert({ resolvedAt: 2000 }), server: server() });
    const resolvedBody = JSON.parse((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(resolvedBody.text).toContain("resolved");
  });

  it("uses a different visual marker per severity", async () => {
    const fetchImpl = fakeFetch();
    const notifier = new SlackNotifier({ webhookUrl: "https://hooks.slack.com/x", fetchImpl: fetchImpl as unknown as typeof fetch });

    await notifier.notify({ alert: alert({ severity: "info" }), server: server() });
    await notifier.notify({ alert: alert({ severity: "warning" }), server: server() });
    await notifier.notify({ alert: alert({ severity: "critical" }), server: server() });

    const texts = fetchImpl.mock.calls.map((call) => JSON.parse((call as [string, RequestInit])[1].body as string).text);
    expect(new Set(texts).size).toBe(3); // all three severities produce visually distinct messages
  });

  it("throws when the webhook responds with a non-ok status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" });
    const notifier = new SlackNotifier({ webhookUrl: "https://hooks.slack.com/x", fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(notifier.notify({ alert: alert(), server: server() })).rejects.toThrow(/404/);
  });
});
