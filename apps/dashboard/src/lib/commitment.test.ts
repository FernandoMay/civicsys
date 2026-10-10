/**
 * The commitment disclosure is the most dangerous string in the app: it is the
 * difference between "honest about what commitment_v1 is" and claiming
 * anonymity we cannot deliver. These tests pin both halves of the disclosure.
 */

import { describe, expect, it } from "vitest";

import { commitmentDisclosure, prepareCommitmentBallot } from "./commitment.js";

const ROOT = {
  domain: "brujula-civica/testnet/roster",
  attributes: "district=00",
};

describe("commitmentDisclosure", () => {
  it("says membership is NOT proven on chain", () => {
    const d = commitmentDisclosure("commitment_v1");
    expect(d).toContain("UNVERIFIED_COMMITMENT");
    expect(d).toMatch(/NO está probada/);
  });

  it("says the transaction source is still visible", () => {
    // The tally hides the address; the tx source account does not. Omitting this
    // would be the fake-anonymity claim RFC §0.2 forbids.
    expect(commitmentDisclosure("commitment_v1")).toMatch(/origen visible/);
  });

  it("explicitly denies anonymity", () => {
    expect(commitmentDisclosure("commitment_v1")).toMatch(/No es anonimato/);
  });

  it("never claims a ZK or anonymous mode exists", () => {
    for (const mode of ["commitment_v1", "public_v1", null]) {
      const d = commitmentDisclosure(mode).toLowerCase();
      expect(d).not.toContain("anónimo verificado");
      expect(d).not.toMatch(/voto anónimo(?! )/);
    }
  });

  it("describes public_v1 as transparent", () => {
    const d = commitmentDisclosure("public_v1");
    expect(d).toContain("Transparente");
    expect(d).toMatch(/no anónimo/);
  });

  it("says nothing about an unknown mode rather than guessing", () => {
    const d = commitmentDisclosure("zk_v1");
    expect(d).toContain("zk_v1");
    expect(d).toMatch(/no afirmamos nada/);
  });

  it("reports UNKNOWN when there is no tally", () => {
    expect(commitmentDisclosure(null)).toContain("DESCONOCIDO");
  });
});

describe("prepareCommitmentBallot", () => {
  const base = {
    secret: "a".repeat(64),
    proposalId: 3n,
    choice: 0,
    membershipRoot: "b".repeat(64),
    ...ROOT,
  };

  it("derives a commitment and a nullifier", async () => {
    const r = await prepareCommitmentBallot(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(r.nullifier).toMatch(/^[0-9a-f]{64}$/);
    expect(r.membershipRoot).toBe(base.membershipRoot);
  });

  it("is deterministic for the same secret and proposal", async () => {
    const a = await prepareCommitmentBallot(base);
    const b = await prepareCommitmentBallot(base);
    expect(a.ok && b.ok && a.nullifier === b.nullifier).toBe(true);
  });

  it("changes the nullifier when the proposal changes", async () => {
    const a = await prepareCommitmentBallot(base);
    const b = await prepareCommitmentBallot({ ...base, proposalId: 4n });
    expect(a.ok && b.ok && a.nullifier !== b.nullifier).toBe(true);
  });

  it("blocks with an explanation when no root is published", async () => {
    // The contract would reject this with RootNotSet; refusing here avoids a
    // signed transaction that cannot succeed.
    const r = await prepareCommitmentBallot({ ...base, membershipRoot: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/raíz de membresía/);
    expect(r.reason).toMatch(/RootNotSet/);
  });

  it("blocks without a voter secret", async () => {
    const r = await prepareCommitmentBallot({ ...base, secret: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/secreto/);
  });
});