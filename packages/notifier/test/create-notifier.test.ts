import { describe, expect, it } from "vitest";
import { createNotifier } from "../src/create-notifier.js";
import { WebhookNotifier } from "../src/webhook-notifier.js";
import { SlackNotifier } from "../src/slack-notifier.js";
import { CompositeNotifier } from "../src/composite-notifier.js";

describe("createNotifier", () => {
  it("returns null when nothing is configured", () => {
    expect(createNotifier({})).toBeNull();
  });

  it("returns a WebhookNotifier when only webhookUrl is set", () => {
    const notifier = createNotifier({ webhookUrl: "https://example.com/hook" });
    expect(notifier).toBeInstanceOf(WebhookNotifier);
  });

  it("returns a SlackNotifier when only slackWebhookUrl is set", () => {
    const notifier = createNotifier({ slackWebhookUrl: "https://hooks.slack.com/x" });
    expect(notifier).toBeInstanceOf(SlackNotifier);
  });

  it("returns a CompositeNotifier when both are set", () => {
    const notifier = createNotifier({
      webhookUrl: "https://example.com/hook",
      slackWebhookUrl: "https://hooks.slack.com/x"
    });
    expect(notifier).toBeInstanceOf(CompositeNotifier);
  });
});
