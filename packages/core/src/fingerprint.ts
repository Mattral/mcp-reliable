import { createHash } from "node:crypto";

/**
 * Recursively sorts object keys so that semantically identical JSON values
 * produce identical stringified output regardless of key order. Arrays keep
 * their order (order is usually meaningful there).
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Computes a stable SHA-256 fingerprint for a tool's JSON input schema.
 * Two schemas that are structurally identical (regardless of key order)
 * always produce the same fingerprint. Used to detect schema drift: when a
 * server changes a tool's parameters between observations.
 */
export function computeSchemaFingerprint(schema: unknown): string {
  return sha256(JSON.stringify(canonicalize(schema ?? null)));
}

// Structural signatures are deliberately coarse: we care about *shape* (is
// this a string? an array? how deeply nested?), never about values, since
// values legitimately vary from call to call.
const MAX_SIGNATURE_DEPTH = 6;
const MAX_ARRAY_SAMPLE = 3;
const MAX_OBJECT_KEYS = 40;

function shapeOf(value: unknown, depth: number): unknown {
  if (depth > MAX_SIGNATURE_DEPTH) return "…";
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    // Sample a few elements rather than the whole array: for large arrays of
    // uniform items this keeps signatures compact and stable in length.
    const sample = value.slice(0, MAX_ARRAY_SAMPLE).map((v) => shapeOf(v, depth + 1));
    return { array: sample, length: value.length > MAX_ARRAY_SAMPLE ? "N" : value.length };
  }
  const t = typeof value;
  if (t === "object") {
    const keys = Object.keys(value as Record<string, unknown>)
      .sort()
      .slice(0, MAX_OBJECT_KEYS);
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k] = shapeOf((value as Record<string, unknown>)[k], depth + 1);
    }
    return out;
  }
  // string / number / boolean / bigint / function / symbol -> tag by type only
  return t;
}

/**
 * Computes a structural "shape" signature for a tool's *output*: the set of
 * keys, nesting, and primitive types present, independent of the actual
 * values returned. Two outputs with the same shape but different content
 * hash identically; a genuinely different response shape (a field renamed,
 * removed, or changed from an object to a string) hashes differently.
 *
 * This is the P0-level behavioral drift signal described in the roadmap.
 * It intentionally does NOT do statistical comparison of output values or
 * latency distributions — that is a P1 feature (see docs/roadmap.md).
 */
export function computeOutputSignature(output: unknown): string {
  return sha256(JSON.stringify(shapeOf(output, 0)));
}
