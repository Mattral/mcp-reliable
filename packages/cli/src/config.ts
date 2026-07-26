import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { SqliteStore } from "@mattral/storage";

export const DEFAULT_DATA_DIR = ".mcp-reliable";
export const DEFAULT_DB_FILENAME = "data.sqlite";

/**
 * Resolves the SQLite database path for the current invocation, in order of
 * precedence: an explicit `--db` flag, then the `MCP_RELIABLE_DB`
 * environment variable, then the project-local default
 * `./.mcp-reliable/data.sqlite`. This mirrors the "zero-config for
 * individuals and small teams" storage decision (docs/decisions/0002).
 */
export function resolveDbPath(explicitPath?: string): string {
  if (explicitPath) return path.resolve(explicitPath);
  if (process.env.MCP_RELIABLE_DB) return path.resolve(process.env.MCP_RELIABLE_DB);
  return path.resolve(process.cwd(), DEFAULT_DATA_DIR, DEFAULT_DB_FILENAME);
}

/** Ensures the parent directory of a resolved DB path exists before SQLite tries to open it. */
export function ensureDataDir(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export interface OpenStoreOptions {
  dbPath?: string;
}

/** Opens (creating if necessary) the SqliteStore for this invocation. */
export function openStore(options: OpenStoreOptions = {}): { store: SqliteStore; dbPath: string } {
  const dbPath = resolveDbPath(options.dbPath);
  ensureDataDir(dbPath);
  return { store: new SqliteStore({ path: dbPath }), dbPath };
}
