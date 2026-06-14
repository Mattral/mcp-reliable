import type { Notifier } from "./notifier.js";
import { WebhookNotifier } from "./webhook-notifier.js";
import { SlackNotifier } from "./slack-notifier.js";
import { CompositeNotifier } from "./composite-notifier.js";

export interface NotifierOptions {
  webhookUrl?: string;
  slackWebhookUrl?: string;
}

/**
 * Builds the right `Notifier` (or a `CompositeNotifier` combining both)
 * from CLI-style options. Returns `null` when neither is configured, so
 * callers can skip the notify step entirely rather than holding onto a
 * notifier that does nothing.
 */
export function createNotifier(options: NotifierOptions): Notifier | null {
  const notifiers: Notifier[] = [];
  if (options.webhookUrl) notifiers.push(new WebhookNotifier({ url: options.webhookUrl }));
  if (options.slackWebhookUrl) notifiers.push(new SlackNotifier({ webhookUrl: options.slackWebhookUrl }));

  if (notifiers.length === 0) return null;
  if (notifiers.length === 1) return notifiers[0] as Notifier;
  return new CompositeNotifier(notifiers);
}
