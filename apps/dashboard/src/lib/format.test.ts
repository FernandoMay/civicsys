import { describe, expect, it } from "vitest";

import {
  bigOrUnknown,
  dateOrUnknown,
  reasonOf,
  shortAddress,
  shortHash,
  valueOrNull,
  valueOrUnknown,
  UNKNOWN,
} from "./format.js";
import type { Evidence, Read } from "@brugulacivica/sdk";

const evidence: Evidence = {
  contractId: "CABC",
  rpcUrl: "https://example.invalid",
  fetchedAt: "2026-01-01T00:00:00.000Z",
  ledger: 1,
};

const ok = <T,>(value: T): Read<T> => ({ status: "ok", value, evidence });
const bad = <T,>(reason: string): Read<T> => ({ status: "unknown", reason, evidence });

describe("fail-closed formatting", () => {
  it("never substitutes a default for an unreadable value", () => {
    expect(bigOrUnknown(bad("boom"))).toBe(UNKNOWN);
    expect(valueOrUnknown(bad("boom"))).toBe(UNKNOWN);
    expect(valueOrNull(bad("boom"))).toBeNull();
  });

  it("renders an ok value verbatim", () => {
    expect(bigOrUnknown(ok(42n))).toBe("42");
    expect(valueOrUnknown(ok("hola"))).toBe("hola");
    expect(valueOrUnknown(ok(7n), (v) => `#${String(v)}`)).toBe("#7");
    expect(valueOrNull(ok(1n))).toBe(1n);
  });

  it("renders zero as zero, because zero is a real chain answer", () => {
    // The whole point of fail-closed is distinguishing "0" from "unknown".
    expect(bigOrUnknown(ok(0n))).toBe("0");
  });

  it("exposes the failure reason only for unknown reads", () => {
    expect(reasonOf(bad("red caida"))).toBe("red caida");
    expect(reasonOf(ok(1))).toBeNull();
  });
});

describe("shortHash", () => {
  it("elides the middle but keeps both ends", () => {
    const h = "a".repeat(64);
    expect(shortHash(h)).toBe(`${"a".repeat(10)}…${"a".repeat(6)}`);
  });

  it("does not elide a short string", () => {
    expect(shortHash("abc")).toBe("abc");
  });

  it("renders UNKNOWN for null/undefined/empty", () => {
    expect(shortHash(null)).toBe(UNKNOWN);
    expect(shortHash(undefined)).toBe(UNKNOWN);
    expect(shortHash("")).toBe(UNKNOWN);
  });
});

describe("shortAddress", () => {
  it("keeps both ends of a G address", () => {
    const a = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW2";
    expect(shortAddress(a)).toBe("GABCDE…SVW2".replace("SVW2", a.slice(-4)));
  });

  it("renders UNKNOWN when no wallet is connected", () => {
    expect(shortAddress(null)).toBe(UNKNOWN);
  });
});

describe("dateOrUnknown", () => {
  it("converts ledger unix seconds to a date", () => {
    expect(dateOrUnknown(1_700_000_000n)).not.toBe(UNKNOWN);
  });

  it("renders UNKNOWN for missing or impossible timestamps", () => {
    expect(dateOrUnknown(null)).toBe(UNKNOWN);
    expect(dateOrUnknown(undefined)).toBe(UNKNOWN);
    expect(dateOrUnknown(0n)).toBe(UNKNOWN);
  });
});