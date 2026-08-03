# @mattral/notifier

Webhook and Slack delivery for [mcp-reliable](https://www.npmjs.com/package/mcp-reliable)
alerts.

```bash
npm install @mattral/notifier
```

## Usage

```ts
import { createNotifier } from "@mattral/notifier";

const notifier = createNotifier({
  webhookUrl: "https://example.com/hooks/mcp-reliable",
  slackWebhookUrl: "https://hooks.slack.com/services/..."
});

// null if neither URL was provided; otherwise a single Notifier that
// delivers to whichever URL(s) were configured (both, if both are set —
// one failing to deliver doesn't block the other).
await notifier?.notify(alert);
```

## Learn more

See the [mcp-reliable GitHub repo](https://github.com/Mattral/mcp-reliable)
for how this fits into `mcp-reliable monitor` and `mcp-reliable proxy`'s
alerting.

## License

MIT
