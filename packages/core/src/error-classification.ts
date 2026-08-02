import type { Execution } from "./types.js";

export const ERROR_CATEGORIES = [
  "timeout",
  "rate-limit",
  "auth",
  "not-found",
  "validation",
  "connection",
  "server-error",
  "unknown"
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

interface CategoryRule {
  category: Exclude<ErrorCategory, "unknown">;
  patterns: RegExp[];
}

/**
 * Checked in order, first match wins. Ordered roughly by specificity —
 * "rate-limit" before "auth" so a 429 doesn't get misread by an overly
 * broad 4xx rule, etc. — though in practice each rule's patterns are
 * distinct enough that overlap is rare.
 *
 * This is deliberately simple regex matching against free-text error
 * messages, not a learned classifier — error messages here come from
 * arbitrary third-party MCP servers with no shared format to rely on
 * (unlike, say, HTTP status codes in a controlled API). Simple pattern
 * matching over a fixed taxonomy is easy to audit, easy to extend, and
 * good enough to separate "this tool needs a longer timeout" from "this
 * tool needs a different API key" — see
 * docs/decisions/0016-error-classification.md for the full reasoning,
 * including the known false-positive/false-negative trade-offs of a
 * pattern-based approach (e.g. a message that happens to contain "404"
 * as an unrelated number, or a genuinely novel phrasing this doesn't
 * recognize, both fall to "unknown" or a neighboring category rather
 * than the "correct" one).
 */
const RULES: readonly CategoryRule[] = [
  {
    category: "rate-limit",
    patterns: [/rate.?limit/i, /\b429\b/, /too many requests/i, /quota exceeded/i]
  },
  {
    category: "auth",
    patterns: [
      /unauthori[sz]ed/i,
      /\b401\b/,
      /\b403\b/,
      /forbidden/i,
      /invalid (?:api[\s-]?key|credentials|token)/i,
      /authentication fail/i
    ]
  },
  {
    category: "not-found",
    patterns: [/not found/i, /\b404\b/, /no such (?:tool|resource|file|server)/i, /does not exist/i]
  },
  {
    category: "timeout",
    patterns: [/\btimed?[\s-]?out\b/i, /\bETIMEDOUT\b/, /deadline exceeded/i]
  },
  {
    category: "validation",
    patterns: [
      /invalid (?:input|argument|parameter)/i,
      /required.{0,20}missing/i,
      /missing.{0,20}required/i,
      /validation failed/i,
      /\b400\b/,
      /bad request/i
    ]
  },
  {
    category: "connection",
    patterns: [
      /ECONNREFUSED/,
      /ECONNRESET/,
      /connection refused/i,
      /network error/i,
      /\bEPIPE\b/,
      /ENOTFOUND/,
      /socket hang ?up/i
    ]
  },
  {
    category: "server-error",
    patterns: [/internal server error/i, /\b500\b/, /internal error/i]
  }
];

/**
 * Classifies a raw error message string into a fixed set of common
 * failure modes. Returns `"unknown"` if nothing matches — a common,
 * expected outcome for arbitrary third-party tool error text, not a bug.
 */
export function classifyError(errorMessage: string): ErrorCategory {
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(errorMessage))) {
      return rule.category;
    }
  }
  return "unknown";
}

export interface ErrorCategorySummary {
  category: ErrorCategory;
  count: number;
  /** This category's share of all *failed* executions considered, in [0, 1] — not a share of all executions. */
  ratio: number;
  /** One real example message from this category, so a human can see what actually produced this classification. */
  exampleMessage: string;
}

/**
 * Groups a set of executions' failures by classified error category,
 * sorted by count descending (the most common failure mode first — the
 * one worth investigating first). Executions that succeeded, or that
 * failed without a recorded `errorMessage`, are excluded entirely; `ratio`
 * is computed against the count of failures *with* a message, not the
 * full execution set, so the ratios in the result always sum to 1.
 *
 * Returns `[]` if there are no classifiable failures — including the
 * common case of a server with no failures at all.
 */
export function summarizeErrorCategories(executions: readonly Execution[]): ErrorCategorySummary[] {
  const failed = executions.filter(
    (e): e is Execution & { errorMessage: string } => !e.success && Boolean(e.errorMessage)
  );
  if (failed.length === 0) return [];

  const byCategory = new Map<ErrorCategory, { count: number; exampleMessage: string }>();
  for (const execution of failed) {
    const category = classifyError(execution.errorMessage);
    const existing = byCategory.get(category);
    if (existing) {
      existing.count += 1;
    } else {
      byCategory.set(category, { count: 1, exampleMessage: execution.errorMessage });
    }
  }

  return [...byCategory.entries()]
    .map(([category, { count, exampleMessage }]) => ({
      category,
      count,
      ratio: count / failed.length,
      exampleMessage
    }))
    .sort((a, b) => b.count - a.count);
}
