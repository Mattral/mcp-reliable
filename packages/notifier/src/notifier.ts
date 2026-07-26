import type { Alert, Server } from "@mattral/core";

export interface NotificationPayload {
  alert: Alert;
  /** Only ever used for its id/name here — see WebhookNotifier/SlackNotifier, which never forward the full Server (transport config may carry secrets in env/headers). */
  server: Server;
}

/** Something that can deliver a single alert notification. Implementations should throw on delivery failure rather than swallow it — see CompositeNotifier for how multiple notifiers' failures get isolated from each other. */
export interface Notifier {
  notify(payload: NotificationPayload): Promise<void>;
}
