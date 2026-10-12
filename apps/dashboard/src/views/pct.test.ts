import { describe, expect, it } from "vitest";

import { pct } from "./Vote.js";

/**
 * The tally bar and the per-option label must agree, and neither may render a
 * doubled unit. Returning '%' from `pct` made the label show "100.0%%" while
 * the bar width got "100.0%%" as an invalid CSS length.
 */
describe("pct", () => {
  it("returns a bare number so the caller adds the unit exactly once", () => {
    expect(pct(1n, 1n)).toBe("100.0");
    expect(`${pct(1n, 1n)}%`).toBe("100.0%");
  });

  it("never emits a percent sign of its own", () => {
    for (const [part, total] of [
      [0n, 1n],
      [1n, 3n],
      [1n, 2n],
      [2n, 3n],
      [7n, 7n],
    ] as const) {
      expect(pct(part, total)).not.toContain("%");
    }
  });

  it("does not divide by zero when the tally is empty", () => {
    expect(pct(0n, 0n)).toBe("0.0");
  });

  it("rounds to one decimal and truncates rather than overstating", () => {
    expect(pct(1n, 3n)).toBe("33.3");
    expect(pct(2n, 3n)).toBe("66.6");
    // 0.04% must not round up to 0.1% and overstate support.
    expect(pct(1n, 3000n)).toBe("0.0");
  });

  // The whole point of truncation: a near-unanimous tally must never read as a
  // unanimous one. Understating is acceptable, overstating is a lie.
  it("never renders 100.0 unless every vote is present", () => {
    expect(pct(9999n, 10_000n)).toBe("99.9");
    expect(pct(999_999n, 1_000_000n)).toBe("99.9");
    expect(pct(1n, 1n)).toBe("100.0");
    expect(pct(1_000_000n, 1_000_000n)).toBe("100.0");
  });

  it("stays exact at the full count", () => {
    expect(pct(1_000_000n, 1_000_000n)).toBe("100.0");
  });
});
