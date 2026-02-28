import { describe, expect, it } from "vitest";
import { canonicalize, computeOutputSignature, computeSchemaFingerprint } from "../src/fingerprint.js";

describe("canonicalize", () => {
  it("sorts object keys recursively", () => {
    const a = canonicalize({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalize({ a: { c: 3, d: 2 }, b: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("preserves array order", () => {
    const result = canonicalize({ list: [3, 1, 2] }) as { list: number[] };
    expect(result.list).toEqual([3, 1, 2]);
  });
});

describe("computeSchemaFingerprint", () => {
  it("is stable across key order", () => {
    const s1 = { type: "object", properties: { a: { type: "string" }, b: { type: "number" } } };
    const s2 = { properties: { b: { type: "number" }, a: { type: "string" } }, type: "object" };
    expect(computeSchemaFingerprint(s1)).toBe(computeSchemaFingerprint(s2));
  });

  it("changes when a property type changes", () => {
    const s1 = { properties: { a: { type: "string" } } };
    const s2 = { properties: { a: { type: "number" } } };
    expect(computeSchemaFingerprint(s1)).not.toBe(computeSchemaFingerprint(s2));
  });

  it("changes when a required property is added", () => {
    const s1 = { properties: { a: { type: "string" } }, required: ["a"] };
    const s2 = { properties: { a: { type: "string" }, b: { type: "string" } }, required: ["a", "b"] };
    expect(computeSchemaFingerprint(s1)).not.toBe(computeSchemaFingerprint(s2));
  });

  it("treats null/undefined schema consistently", () => {
    expect(computeSchemaFingerprint(undefined)).toBe(computeSchemaFingerprint(null));
  });
});

describe("computeOutputSignature", () => {
  it("is identical for same-shape outputs with different values", () => {
    const o1 = { status: "ok", items: [{ id: 1, name: "a" }] };
    const o2 = { status: "error", items: [{ id: 42, name: "zzz" }] };
    expect(computeOutputSignature(o1)).toBe(computeOutputSignature(o2));
  });

  it("differs when a field is added", () => {
    const o1 = { status: "ok" };
    const o2 = { status: "ok", extra: true };
    expect(computeOutputSignature(o1)).not.toBe(computeOutputSignature(o2));
  });

  it("differs when a field's type changes from object to string", () => {
    const o1 = { data: { nested: true } };
    const o2 = { data: "a string now" };
    expect(computeOutputSignature(o1)).not.toBe(computeOutputSignature(o2));
  });

  it("is stable for large arrays regardless of exact length or values", () => {
    const o1 = { list: [1, 2, 3, 4, 5, 6, 7, 8, 9] };
    const o2 = { list: [9, 8, 7, 6, 5] };
    // Both arrays exceed the sampling threshold, so length is bucketed to
    // "N" for both and only the sampled elements' shapes are compared.
    expect(computeOutputSignature(o1)).toBe(computeOutputSignature(o2));
  });

  it("differs for small arrays whose exact length differs", () => {
    const o1 = { list: [1, 2] };
    const o2 = { list: [1, 2, 3] };
    // Below the sampling threshold, exact length is part of the signature.
    expect(computeOutputSignature(o1)).not.toBe(computeOutputSignature(o2));
  });

  it("handles null and primitive top-level outputs without throwing", () => {
    expect(() => computeOutputSignature(null)).not.toThrow();
    expect(() => computeOutputSignature("just a string")).not.toThrow();
    expect(() => computeOutputSignature(42)).not.toThrow();
  });
});
