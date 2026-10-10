/**
 * Live test against the deployed Stellar testnet contracts.
 * Requires network access; run with: pnpm test:live
 *
 * This is the SDK-level evidence that reads are wired to the real chain and
 * that fail-closed behavior holds end-to-end.
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadDeployment } from "../src/node.js";
import { BrujulaReader } from "../src/reads.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const record = loadDeployment(join(root, "deployments", "testnet.json"));
const reader = new BrujulaReader(record);

/** JSON.stringify with BigInt support for assertion messages. */
const show = (r: unknown) =>
  JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? `${v}` : v));

describe("live testnet reads", () => {
  it("reads the identity contract admin (deployed state exists)", async () => {
    const r = await reader.admin("brujula-identity");
    expect(r.status, show(r)).toBe("ok");
    if (r.status === "ok") {
      expect(r.value).toMatch(/^G[A-Z2-7]{55}$/);
      expect(r.evidence.contractId).toBe(reader.contractId("brujula-identity"));
      expect(r.evidence.ledger).toBeGreaterThan(0);
    }
  });

  it("reads the proposal counter", async () => {
    const r = await reader.nextProposalId();
    expect(r.status, show(r)).toBe("ok");
    if (r.status === "ok") expect(r.value).toBeGreaterThanOrEqual(1n);
  });

  it("reads accountability report count", async () => {
    const r = await reader.reportCount();
    expect(r.status, show(r)).toBe("ok");
    if (r.status === "ok") expect(r.value).toBeGreaterThanOrEqual(0n);
  });

  it("tally read for a proposal with no votes: ok + null, verdict unknown", async () => {
    const r = await reader.verifyTally(999999n);
    expect(r.status, show(r)).toBe("ok");
    if (r.status === "ok") {
      expect(r.value.tally).toBeNull();
      expect(r.value.verdict).toBe("unknown"); // fail-closed, never 'verified'
    }
  });

  it("returns unknown (not a fabricated value) for a nonexistent proposal status", async () => {
    const r = await reader.proposalStatus(999999n);
    // contract traps with NotFound => unknown envelope, never a default
    expect(r.status).toBe("unknown");
    if (r.status === "unknown") expect(r.reason).toContain("brujula-proposal.status");
  });

  it("reads the admin's credential as null (not issued) or a well-formed record (issued)", async () => {
    // use the deployed source account — a real, checksum-valid address
    const r = await reader.getCredential(record.source_account);
    expect(r.status, show(r)).toBe("ok");
    if (r.status === "ok") {
      if (r.value !== null) {
        // shape must match the on-chain Credential exactly (RFC §3.1)
        expect(r.value.subject).toBe(record.source_account);
        expect(r.value.commitment).toMatch(/^[0-9a-f]{64}$/);
        expect([0, 1, 2]).toContain(r.value.status);
        expect(typeof r.value.eligible).toBe("boolean");
      }
    }
  });

  it("invariant: any proposal with a tally must verify as consistent", async () => {
    const next = await reader.nextProposalId();
    expect(next.status, show(next)).toBe("ok");
    if (next.status !== "ok" || next.value <= 1n) return; // no proposals yet

    // status of an EXISTING proposal must be a successful read (regression:
    // Result-returning fns come back Ok-wrapped)
    const st = await reader.proposalStatus(1n);
    expect(st.status, show(st)).toBe("ok");
    if (st.status === "ok") expect([0, 1, 2, 3]).toContain(st.value);

    // smoke test created proposal 1 — its tally must exist and verify
    const v = await reader.verifyTally(1n);
    expect(v.status, show(v)).toBe("ok");
    if (v.status === "ok") {
      expect(v.value.tally, show(v.value)).not.toBeNull();
      expect(v.value.verdict).toBe("verified");
      expect(["public_v1", "commitment_v1"]).toContain(v.value.mode);
    }

    // and the credential of the voting admin must be readable + eligible
    const cred = await reader.getCredential(record.source_account);
    expect(cred.status, show(cred)).toBe("ok");
    if (cred.status === "ok" && cred.value) {
      expect(cred.value.status).toBe(0); // ACTIVE
      expect(cred.value.eligible).toBe(true);
    }
  });
});
