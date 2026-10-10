/**
 * Hashing helpers. Cross-checked against Node's own `crypto.createHash`, so a
 * WebCrypto misuse (wrong algorithm name, wrong encoding) fails here rather
 * than silently producing different digests than every other tool.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { concatBytes, isSha256Hex, sha256Bytes, sha256Hex, sha256Utf8, utf8Bytes } from "../src/hash.js";

const nodeSha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("sha256", () => {
  it("matches Node's sha256 for the empty string", async () => {
    expect(await sha256Utf8("")).toBe(nodeSha(""));
  });

  it("matches Node's sha256 for ascii", async () => {
    expect(await sha256Utf8("abc")).toBe(nodeSha("abc"));
  });

  it("matches Node's sha256 for multi-byte utf-8", async () => {
    const s = "Brújula Cívica · 决策 · ρόδος";
    expect(await sha256Utf8(s)).toBe(nodeSha(s));
  });

  it("handles a large input", async () => {
    const s = "x".repeat(1_000_000);
    expect(await sha256Utf8(s)).toBe(nodeSha(s));
  });

  it("returns lowercase hex of the right length", async () => {
    const d = await sha256Utf8("abc");
    expect(d).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes bytes independently of view offset", async () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = backing.subarray(2, 5);
    expect(await sha256Bytes(view)).toBe(await sha256Bytes(new Uint8Array([1, 2, 3])));
  });

  it("sha256Hex accepts a hex string with or without 0x", async () => {
    expect(await sha256Hex("616263")).toBe(await sha256Utf8("abc"));
    expect(await sha256Hex("0x616263")).toBe(await sha256Utf8("abc"));
  });

  it("sha256Hex accepts uppercase hex", async () => {
    expect(await sha256Hex("616263".toUpperCase())).toBe(await sha256Utf8("abc"));
  });

  it("rejects malformed hex rather than hashing something else", async () => {
    await expect(sha256Hex("xyz")).rejects.toThrow(/hex/);
    await expect(sha256Hex("abc")).rejects.toThrow(/hex/); // odd length
  });
});

describe("concatBytes", () => {
  it("concatenates in order", () => {
    expect([...concatBytes(new Uint8Array([1, 2]), new Uint8Array([3]))]).toEqual([1, 2, 3]);
  });

  it("handles empty inputs", () => {
    expect(concatBytes(new Uint8Array(), new Uint8Array([7]), new Uint8Array())).toEqual(
      new Uint8Array([7]),
    );
  });

  it("does not alias its inputs", () => {
    const a = new Uint8Array([1, 2]);
    const out = concatBytes(a, new Uint8Array([3]));
    out[0] = 99;
    expect(a[0]).toBe(1);
  });
});

describe("utf8Bytes", () => {
  it("encodes as utf-8, not latin-1", async () => {
    expect(await sha256Bytes(utf8Bytes("é"))).toBe(nodeSha("é"));
  });
});

describe("isSha256Hex", () => {
  it("accepts a real digest and rejects everything else", () => {
    expect(isSha256Hex("a".repeat(64))).toBe(true);
    expect(isSha256Hex("A".repeat(64))).toBe(false);
    expect(isSha256Hex("a".repeat(63))).toBe(false);
    expect(isSha256Hex("z".repeat(64))).toBe(false);
    expect(isSha256Hex(null)).toBe(false);
    expect(isSha256Hex(123)).toBe(false);
  });
});