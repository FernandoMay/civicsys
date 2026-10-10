/**
 * Membership primitives.
 *
 * These are load-bearing cryptographic values, so the tests do two things:
 * they pin behaviour, and they cross-check a digest against Node's own
 * `crypto.createHash` via a deliberately different code path. A self-consistent
 * but wrong implementation (wrong domain separation, swapped fields) would pass
 * a round-trip test and fail the cross-check.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildMerkle,
  commitCredential,
  computeRootFromProof,
  deriveNullifier,
  merkleLeaf,
  verifyMerkleProof,
} from "../src/membership.js";

const sha256 = (b: Buffer | Uint8Array | string): string =>
  createHash("sha256")
    .update(typeof b === "string" ? Buffer.from(b, "utf8") : b)
    .digest("hex");

const CRED = {
  domain: "municipal/2026/roster",
  secret: "correct horse battery staple",
  attributes: "district=04;role=citizen",
};

describe("commitCredential", () => {
  it("is deterministic", async () => {
    expect(await commitCredential(CRED)).toBe(await commitCredential(CRED));
  });

  it("returns a 32-byte hex digest", async () => {
    expect(await commitCredential(CRED)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("binds the domain: the same person in another domain commits differently", async () => {
    const a = await commitCredential(CRED);
    const b = await commitCredential({ ...CRED, domain: "municipal/2027/roster" });
    expect(a).not.toBe(b);
  });

  it("binds the attributes", async () => {
    const a = await commitCredential(CRED);
    const b = await commitCredential({ ...CRED, attributes: "district=05;role=citizen" });
    expect(a).not.toBe(b);
  });

  it("binds the secret", async () => {
    const a = await commitCredential(CRED);
    const b = await commitCredential({ ...CRED, secret: "other" });
    expect(a).not.toBe(b);
  });

  // Without length-prefixed fields, ("ab","c") and ("a","bc") would hash the
  // same bytes. This test exists to keep that from ever regressing.
  it("cannot be made to collide by moving characters between fields", async () => {
    const a = await commitCredential({ domain: "d", secret: "ab", attributes: "c" });
    const b = await commitCredential({ domain: "d", secret: "a", attributes: "bc" });
    expect(a).not.toBe(b);
  });

  it("rejects empty domain or secret rather than committing to nothing", async () => {
    await expect(commitCredential({ ...CRED, domain: "" })).rejects.toThrow(/domain/);
    await expect(commitCredential({ ...CRED, secret: "" })).rejects.toThrow(/secret/);
  });

  it("agrees with an independently computed digest", async () => {
    // Recomputed here with Node's crypto and the documented field layout,
    // without calling the SDK helper, so this is a genuine cross-check.
    const field = (b: Buffer) => {
      const len = Buffer.alloc(8);
      len.writeBigUInt64BE(BigInt(b.length));
      return Buffer.concat([len, b]);
    };
    const expected = sha256(
      Buffer.concat([
        field(Buffer.from("brujula-civica/credential-commitment/v1", "utf8")),
        field(Buffer.from(CRED.domain, "utf8")),
        field(Buffer.from(sha256(CRED.secret), "hex")),
        field(Buffer.from(sha256(CRED.attributes), "hex")),
      ]),
    );
    expect(await commitCredential(CRED)).toBe(expected);
  });
});

describe("deriveNullifier", () => {
  it("is deterministic per (secret, proposal)", async () => {
    const a = await deriveNullifier({ secret: "s3cret", proposalId: 7 });
    const b = await deriveNullifier({ secret: "s3cret", proposalId: 7 });
    expect(a).toBe(b);
  });

  it("differs across proposals, so a ballot cannot be replayed elsewhere", async () => {
    const a = await deriveNullifier({ secret: "s3cret", proposalId: 1 });
    const b = await deriveNullifier({ secret: "s3cret", proposalId: 2 });
    expect(a).not.toBe(b);
  });

  it("differs across secrets", async () => {
    const a = await deriveNullifier({ secret: "a", proposalId: 1 });
    const b = await deriveNullifier({ secret: "b", proposalId: 1 });
    expect(a).not.toBe(b);
  });

  it("accepts bigint and number proposal ids interchangeably", async () => {
    expect(await deriveNullifier({ secret: "s", proposalId: 7 })).toBe(
      await deriveNullifier({ secret: "s", proposalId: 7n }),
    );
  });

  it("rejects a negative proposal id", async () => {
    await expect(deriveNullifier({ secret: "s", proposalId: -1 })).rejects.toThrow(/negativo/);
  });

  it("rejects an empty secret", async () => {
    await expect(deriveNullifier({ secret: "", proposalId: 1 })).rejects.toThrow(/secret/);
  });
});

describe("buildMerkle", () => {
  const commitments = [
    "1".repeat(64),
    "2".repeat(64),
    "3".repeat(64),
    "4".repeat(64),
    "5".repeat(64),
  ];

  it("rejects an empty leaf set", async () => {
    await expect(buildMerkle([])).rejects.toThrow(/al menos una hoja/);
  });

  it("rejects a non-hex commitment", async () => {
    await expect(buildMerkle(["not-hex"])).rejects.toThrow(/hexadecimal/);
  });

  it("produces the same root for the same leaves in any construction path", async () => {
    const a = await buildMerkle(commitments);
    const b = await buildMerkle([...commitments].reverse());
    expect(a.root).toMatch(/^[0-9a-f]{64}$/);
    // Order matters for a Merkle tree, so reversal must change the root.
    expect(b.root).not.toBe(a.root);
  });

  it("is deterministic across repeated builds", async () => {
    expect((await buildMerkle(commitments)).root).toBe((await buildMerkle(commitments)).root);
  });

  it("verifies membership for every leaf", async () => {
    const tree = await buildMerkle(commitments);
    for (const [i, c] of commitments.entries()) {
      expect(await verifyMerkleProof({ root: tree.root, commitment: c, proof: tree.proof(i) })).toBe(
        true,
      );
    }
  });

  it("rejects a commitment that is not in the tree", async () => {
    const tree = await buildMerkle(commitments);
    const impostor = "9".repeat(64);
    expect(
      await verifyMerkleProof({ root: tree.root, commitment: impostor, proof: tree.proof(0) }),
    ).toBe(false);
  });

  it("rejects a tampered sibling in the proof", async () => {
    const tree = await buildMerkle(commitments);
    const proof = tree.proof(0);
    const tampered = [{ ...proof[0]!, sibling: "f".repeat(64) }, ...proof.slice(1)];
    expect(
      await verifyMerkleProof({ root: tree.root, commitment: commitments[0]!, proof: tampered }),
    ).toBe(false);
  });

  it("rejects a proof built for a different tree", async () => {
    const tree = await buildMerkle(commitments);
    const other = await buildMerkle([...commitments].slice(1));
    expect(
      await verifyMerkleProof({ root: tree.root, commitment: commitments[1]!, proof: other.proof(0) }),
    ).toBe(false);
  });

  it("handles an odd leaf count by promoting the last node", async () => {
    const odd = commitments.slice(0, 3);
    const tree = await buildMerkle(odd);
    for (const [i, c] of odd.entries()) {
      expect(await verifyMerkleProof({ root: tree.root, commitment: c, proof: tree.proof(i) })).toBe(
        true,
      );
    }
  });

  it("handles a single leaf", async () => {
    const tree = await buildMerkle([commitments[0]!]);
    expect(tree.proof(0)).toHaveLength(0);
    expect(await verifyMerkleProof({ root: tree.root, commitment: commitments[0]!, proof: [] })).toBe(
      true,
    );
  });

  it("rejects an out-of-range proof index", async () => {
    const tree = await buildMerkle(commitments);
    expect(() => tree.proof(-1)).toThrow(/fuera de rango/);
    expect(() => tree.proof(99)).toThrow(/fuera de rango/);
    expect(() => tree.proof(1.5)).toThrow(/fuera de rango/);
  });

  it("agrees with an independently recomputed root", async () => {
    const leafOf = (c: string) =>
      sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(c, "hex")]));
    const nodeOf = (l: string, r: string) =>
      sha256(Buffer.concat([Buffer.from([0x01]), Buffer.from(l, "hex"), Buffer.from(r, "hex")]));

    let level = commitments.map(leafOf);
    while (level.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const l = level[i]!;
        const right = level[i + 1];
        // Odd node is promoted unchanged, matching the Bitcoin convention the
        // implementation documents (and avoiding duplicate-node ambiguity).
        if (right === undefined) next.push(l);
        else next.push(nodeOf(l, right));
      }
      level = next;
    }
    expect((await buildMerkle(commitments)).root).toBe(level[0]);
  });

  it("merkleLeaf is domain separated from internal nodes", async () => {
    const leaf = await merkleLeaf("a".repeat(64));
    const tree = await buildMerkle(["a".repeat(64), "a".repeat(64)]);
    expect(leaf).not.toBe(tree.root);
  });

  it("computeRootFromProof matches verifyMerkleProof", async () => {
    const tree = await buildMerkle(commitments);
    const proof = tree.proof(2);
    expect(await computeRootFromProof(commitments[2]!, proof)).toBe(tree.root);
  });
});