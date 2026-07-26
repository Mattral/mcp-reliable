import type { AlertSeverity } from "@mattral/core";
import type { Notifier, NotificationPayload } from "./notifier.js";

export interface SlackNotifierOptions {
  webhookUrl: string;
  /** Injectable for testing; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  info: "ℹ️",
  warning: "⚠️",
  critical: "🔴"
};

/**
 * Formats an alert as a Slack incoming-webhook message
 * (https://api.slack.com/messaging/webhooks — a plain `{text}` POST, no
 * Slack app/bot token required). Only sends the server's name, for the
 * same reason `WebhookNotifier` only sends `{id, name}` — see its
 * docstring.
 */
export class SlackNotifier implements Notifier {
  private readonly webhookUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SlackNotifierOptions) {
    this.webhookUrl = options.webhookUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async notify({ alert, server }: NotificationPayload): Promise<void> {
    const emoji = SEVERITY_EMOJI[alert.severity];
    const status = alert.resolvedAt ? "resolved" : "triggered";
    const text = `${emoji} *${server.name}* — ${alert.message} _(${alert.kind}, ${status})_`;

    const response = await this.fetchImpl(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (!response.ok) {
      throw new Error(`Slack webhook POST failed: ${response.status} ${response.statusText}`);
    }
  }
}
