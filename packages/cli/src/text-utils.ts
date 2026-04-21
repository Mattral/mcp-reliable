/**
 * Splits a shell-like command string into tokens, respecting simple double
 * or single quoting (no nested quotes, no escaping) — just enough for
 * `--stdio "npx my-mcp-server --flag value"` without needing a full shell
 * parser. For anything more complex (env vars, pipes, nested quotes), use
 * `add-server ... -- <command> [args...]` instead, which Commander hands
 * to us as an already-split argv array.
 */
export function tokenizeShellLike(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (const char of input.trim()) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/** Turns a human-readable server name into a stable, URL/ID-safe slug. Falls back to "server" if nothing alphanumeric remains. */
export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return slug || "server";
}
