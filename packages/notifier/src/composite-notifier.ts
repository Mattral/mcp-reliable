import type { Notifier, NotificationPayload } from "./notifier.js";

/**
 * Fans a single alert out to multiple notifiers (e.g. both a generic
 * webhook and Slack), isolating failures between them: one notifier
 * throwing doesn't stop the others from being attempted. Aggregates any
 * failures into a single thrown error so the caller still knows something
 * went wrong, without needing to inspect settled-promise results itself.
 */
export class CompositeNotifier implements Notifier {
  private readonly notifiers: readonly Notifier[];

  constructor(notifiers: readonly Notifier[]) {
    this.notifiers = notifiers;
  }

  async notify(payload: NotificationPayload): Promise<void> {
    const results = await Promise.allSettled(this.notifiers.map((n) => n.notify(payload)));
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failures.length > 0) {
      const messages = failures.map((f) => (f.reason instanceof Error ? f.reason.message : String(f.reason)));
      throw new Error(`${failures.length}/${this.notifiers.length} notifier(s) failed: ${messages.join("; ")}`);
    }
  }
}
