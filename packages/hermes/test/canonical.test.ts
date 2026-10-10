/**
 * Canonical JSON is the foundation of every digest Hermes produces. If this
 * serializer is unstable, `evidence_hash` is meaningless, so these tests pin
 * the exact bytes rather than round-tripping through `JSON.parse`.
 */

import { describe, expect, it } from "vitest";

import { CanonicalJsonError, canonicalize } from "../src/canonical.js";

describe("canonicalize", () => {
  it("sorts object keys regardless of insertion order", () => {
    const a = canonicalize({ b: 1, a: 2, c: 3 } as never);
    const b = canonicalize({ c: 3, a: 2, b: 1 } as never);
    expect(a).toBe('{"a":2,"b":1,"c":3}');
    expect(a).toBe(b);
  });

  it("sorts nested objects too", () => {
    expect(canonicalize({ z: { y: 1, x: 2 }, a: [3, 1, 2] } as never)).toBe(
      '{"a":[3,1,2],"z":{"x":2,"y":1}}',
    );
  });

  it("preserves array order — arrays are data, not sets", () => {
    expect(canonicalize([3, 1, 2] as never)).toBe("[3,1,2]");
  });

  it("emits no insignificant whitespace", () => {
    expect(canonicalize({ a: [1, 2], b: { c: 3 } } as never)).toBe('{"a":[1,2],"b":{"c":3}}');
  });

  it("omits undefined properties but keeps null", () => {
    expect(canonicalize({ a: undefined, b: null, c: 1 } as never)).toBe('{"b":null,"c":1}');
  });

  it("escapes control characters and quotes", () => {
    expect(canonicalize('a"b\\c\nd\te\u0001f')).toBe('"a\\"b\\\\c\\nd\\te\\u0001f"');
  });

  it("leaves non-ASCII as literal UTF-8", () => {
    expect(canonicalize("Brújula Cívica")).toBe('"Brújula Cívica"');
  });

  it("normalises -0 to 0 so the hash cannot depend on the sign", () => {
    expect(canonicalize(-0)).toBe("0");
    expect(canonicalize(0)).toBe("0");
  });

  it("rejects non-integer and unsafe numbers instead of rounding them", () => {
    expect(() => canonicalize(1.5)).toThrow(CanonicalJsonError);
    expect(() => canonicalize(Number.NaN)).toThrow(CanonicalJsonError);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(CanonicalJsonError);
    expect(() => canonicalize(2 ** 53)).toThrow(CanonicalJsonError);
  });

  it("rejects bigint loudly, since silently coercing it would change the hash", () => {
    expect(() => canonicalize(1n as never)).toThrow(CanonicalJsonError);
  });

  it("rejects cycles rather than truncating", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(() => canonicalize(a as never)).toThrow(/circular/);
  });

  it("rejects non-plain objects", () => {
    expect(() => canonicalize(new Date() as never)).toThrow(CanonicalJsonError);
  });

  it("sorts by UTF-16 code unit, so uppercase precedes lowercase", () => {
    expect(canonicalize({ b: 1, A: 2, a: 3 } as never)).toBe('{"A":2,"a":3,"b":1}');
  });

  it("is stable across repeated calls (no shared mutable state)", () => {
    const shared = { z: 1, a: { y: 2, b: 3 } };
    const first = canonicalize(shared as never);
    expect(canonicalize(shared as never)).toBe(first);
    expect(canonicalize(shared as never)).toBe(first);
  });
});