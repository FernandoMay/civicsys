import { describe, expect, it } from "vitest";
import { verifyTally, KNOWN_MODES } from "../src/verifier.js";
import type { TallyView } from "../src/types.js";

function tally(over: Partial<TallyView> = {}): TallyView {
  return {
    proposal_id: 1n,
    total: 0n,
    counts: new Map<number, bigint>(),
    public_votes: 0n,
    commitment_votes: 0n,
    verification_mode: "public_v1",
    ...over,
  };
}

describe("verifyTally", () => {
  it("verifies an honest public tally", () => {
    const t = tally({
      total: 3n,
      counts: new Map([
        [0, 2n],
        [1, 1n],
      ]),
      public_votes: 3n,
      verification_mode: "public_v1",
    });
    const r = verifyTally(t);
    expect(r.verdict).toBe("verified");
    expect(r.checks.every((c) => c.state === true)).toBe(true);
  });

  it("verifies an honest mixed tally in commitment_v1 mode", () => {
    const t = tally({
      total: 4n,
      counts: new Map([
        [0, 1n],
        [1, 3n],
      ]),
      public_votes: 2n,
      commitment_votes: 2n,
      verification_mode: "commitment_v1",
    });
    expect(verifyTally(t).verdict).toBe("verified");
  });

  it("returns unknown (not verified) when no tally exists", () => {
    const r = verifyTally(null);
    expect(r.verdict).toBe("unknown");
    expect(r.mode).toBeNull();
    expect(r.checks.find((c) => c.id === "tally_exists")?.state).toBe("unknown");
  });

  it("detects total != sum(counts) as mismatch", () => {
    const t = tally({
      total: 10n, // inflated
      counts: new Map([[0, 3n]]),
      public_votes: 10n,
      verification_mode: "public_v1",
    });
    const r = verifyTally(t);
    expect(r.verdict).toBe("mismatch");
    expect(r.checks.find((c) => c.id === "total_equals_sum_counts")?.state).toBe(false);
  });

  it("detects split inconsistency as mismatch", () => {
    const t = tally({
      total: 5n,
      counts: new Map([[0, 5n]]),
      public_votes: 3n,
      commitment_votes: 1n, // 3+1 != 5
      verification_mode: "commitment_v1",
    });
    const r = verifyTally(t);
    expect(r.verdict).toBe("mismatch");
    expect(r.checks.find((c) => c.id === "total_equals_mode_split")?.state).toBe(false);
  });

  it("detects public mode carrying commitment ballots as mismatch", () => {
    const t = tally({
      total: 2n,
      counts: new Map([[0, 2n]]),
      public_votes: 1n,
      commitment_votes: 1n,
      verification_mode: "public_v1",
    });
    const r = verifyTally(t);
    expect(r.verdict).toBe("mismatch");
    expect(r.checks.find((c) => c.id === "mode_consistent_with_split")?.state).toBe(false);
  });

  it("never claims anonymity for zk_* modes without a verified verifier", () => {
    const t = tally({
      total: 1n,
      counts: new Map([[0, 1n]]),
      commitment_votes: 1n,
      verification_mode: "zk_v1",
    });
    expect(verifyTally(t).verdict).toBe("unknown");
    // even with the flag set, an independently verified proof is required
    expect(verifyTally(t, { zkVerifierDeployed: true }).verdict).toBe("unknown");
  });

  it("flags unknown verification modes as mismatch", () => {
    const t = tally({ verification_mode: "trust_me_bro" });
    const r = verifyTally(t);
    expect(r.verdict).toBe("mismatch");
    expect(r.checks.find((c) => c.id === "mode_recognized")?.state).toBe(false);
  });

  it("detects negative values as mismatch", () => {
    const t = tally({
      total: -1n,
      public_votes: -1n,
      verification_mode: "public_v1",
    });
    expect(verifyTally(t).verdict).toBe("mismatch");
  });

  it("exposes exactly the v0.1 honest modes", () => {
    expect([...KNOWN_MODES]).toEqual(["public_v1", "commitment_v1"]);
    expect(KNOWN_MODES.some((m) => m.startsWith("zk"))).toBe(false);
  });
});
