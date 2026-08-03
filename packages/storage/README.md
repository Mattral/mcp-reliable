# @mattral/storage

SQLite-backed persistence layer for [mcp-reliable](https://www.npmjs.com/package/mcp-reliable)
— servers, tools, executions, drift events, alerts, and health-score
history, behind one `ReliabilityStore` interface.

```bash
npm install @mattral/storage
```

## Usage

```ts
import { SqliteStore } from "@mattral/storage";

const store = new SqliteStore({ path: "./mcp-reliable.db" });

store.upsertServer({ id: "my-server", name: "My Server", /* ... */ });
store.recordExecution({ /* ... */ });

const executions = store.listExecutions({ serverId: "my-server", limit: 100 });
```

Schema migrations run automatically on open (tracked via SQLite's
`PRAGMA user_version`) — opening an older database file transparently
brings it forward to the current schema.

## Learn more

See the [mcp-reliable GitHub repo](https://github.com/Mattral/mcp-reliable)
for the full data model (`docs/data-model.md`) and how this package fits
into the rest of the system.

## License

MIT
