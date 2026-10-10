/**
 * Tests for the chain-shape normalisers.
 *
 * These are the functions that decide whether an on-chain answer is
 * trustworthy enough to render. They live in the fail-closed path: anything
 * they cannot parse must throw, which the reader converts into an `unknown`
 * read. A permissive normaliser here would let a malformed payload reach the UI
 * as a real value.
 */

import { describe, expect, it } from "vitest";

import { toCounts } from "../src/reads.js";

describe("toCounts", () => {
  it("accepts a JS Map", () => {
    const m = toCounts(new Map<number, bigint>([[0, 2n]]));
    expect(m.get(0)).toBe(2n);
  });

  it("accepts the [[k,v],...] pair array the RPC returns", () => {
    const m = toCounts([
      [0, 2],
      [1, "3"],
    ]);
    expect(m.get(0)).toBe(2n);
    expect(m.get(1)).toBe(3n);
  });

  it("accepts a plain object", () => {
    const m = toCounts({ 0: 5, 2: 1 });
    expect(m.get(0)).toBe(5n);
    expect(m.get(2)).toBe(1n);
  });

  it("accepts numeric string keys", () => {
    expect(toCounts({ "7": 2 }).get(7)).toBe(2n);
  });

  it("preserves a zero count instead of dropping the bucket", () => {
    // A zero is a real answer: "nobody chose this option". Dropping it would
    // hide a bucket that exists on chain.
    const m = toCounts({ 0: 0 });
    expect(m.size).toBe(1);
    expect(m.get(0)).toBe(0n);
  });

  it("returns an empty map for an empty counts object", () => {
    expect(toCounts({}).size).toBe(0);
  });

  // --- rejection cases: every one of these must THROW, never coerce ---

  it("rejects a negative count", () => {
    expect(() => toCounts({ 0: -1 })).toThrow();
  });

  it("rejects a negative key", () => {
    expect(() => toCounts({ "-1": 1 })).toThrow();
  });

  it("rejects a non-integer count", () => {
    expect(() => toCounts({ 0: 1.5 })).toThrow();
  });

  it("rejects a malformed pair", () => {
    expect(() => toCounts([[0]])).toThrow();
  });

  it("rejects an unrecognised shape", () => {
    expect(() => toCounts(null)).toThrow();
    expect(() => toCounts(42)).toThrow();
    expect(() => toCounts("nope")).toThrow();
  });
});