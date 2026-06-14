import type { Notifier, NotificationPayload } from "./notifier.js";

export interface WebhookNotifierOptions {
  url: string;
  /** Extra headers, e.g. an auth token for a private receiver. */
  headers?: Record<string, string>;
  /** Injectable for testing; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Sends a generic JSON POST for every alert — the escape hatch for any
 * receiver that isn't Slack specifically (PagerDuty, a custom internal
 * endpoint, etc). Only ever sends `{id, name}` for the server, never the
 * full `Server` object — its `transport` may carry secrets in `env` or
 * `headers`, and a webhook receiver is a third party by definition. See
 * docs/decisions/0010-alerting-notifier-design.md.
 */
export class WebhookNotifier implements Notifier {
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(options: WebhookNotifierOptions) {
    this.url = options.url;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.headers = options.headers ?? {};
  }

  async notify({ alert, server }: NotificationPayload): Promise<void> {
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.headers },
      body: JSON.stringify({
        event: "mcp-reliable.alert",
        alert,
        server: { id: server.id, name: server.name }
      })
    });
    if (!response.ok) {
      throw new Error(`Webhook POST to ${this.url} failed: ${response.status} ${response.statusText}`);
    }
  }
}
