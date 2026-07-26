import { describe, expect, it } from "vitest";
import type { Alert, Server } from "@mattral/core";
import { CompositeNotifier } from "../src/composite-notifier.js";
import type { Notifier } from "../src/notifier.js";

function payload() {
  const server: Server = {
    id: "srv-1",
    name: "my-server",
    transport: { type: "stdio", command: "npx", args: [] },
    tags: [],
    createdAt: 0,
    healthCheckIntervalMs: 60_000
  };
  const alert: Alert = {
    id: "alert-1",
    serverId: "srv-1",
    triggeredAt: 1000,
    severity: "critical",
    kind: "unreachable",
    message: "Server unreachable"
  };
  return { alert, server };
}

function fakeNotifier(shouldFail = false): Notifier & { calls: number } {
  const notifier = {
    calls: 0,
    async notify() {
      notifier.calls++;
      if (shouldFail) throw new Error("delivery failed");
    }
  };
  return notifier;
}

describe("CompositeNotifier", () => {
  it("calls every notifier", async () => {
    const a = fakeNotifier();
    const b = fakeNotifier();
    const composite = new CompositeNotifier([a, b]);

    await composite.notify(payload());

    expect(a.calls).toBe(1);
    expect(b.calls).toBe(1);
  });

  it("isolates failures: one notifier throwing does not stop the others from being attempted", async () => {
    const failing = fakeNotifier(true);
    const succeeding = fakeNotifier(false);
    const composite = new CompositeNotifier([failing, succeeding]);

    await expect(composite.notify(payload())).rejects.toThrow();
    expect(failing.calls).toBe(1);
    expect(succeeding.calls).toBe(1); // still called, despite the other notifier failing
  });

  it("does not throw when every notifier succeeds", async () => {
    const composite = new CompositeNotifier([fakeNotifier(), fakeNotifier()]);
    await expect(composite.notify(payload())).resolves.toBeUndefined();
  });

  it("aggregates failure messages from multiple failing notifiers", async () => {
    const composite = new CompositeNotifier([fakeNotifier(true), fakeNotifier(true)]);
    await expect(composite.notify(payload())).rejects.toThrow(/2\/2 notifier\(s\) failed/);
  });

  it("works with an empty notifier list (no-op)", async () => {
    const composite = new CompositeNotifier([]);
    await expect(composite.notify(payload())).resolves.toBeUndefined();
  });
});
