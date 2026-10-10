/**
 * Credential commitments, nullifiers and Merkle membership.
 *
 * RFC BRUJULA-CIVICA-ARCH-001 §4 and §5:
 *
 *   credential commitment  c = H(domain ‖ subject_secret ‖ attrs)
 *   nullifier                  n = H(voter_secret ‖ proposal_id)
 *   membership                 Merkle root over the eligible commitments
 *
 * These are real cryptographic primitives, not placeholders. What they do NOT
 * do is prove membership on chain: `brujula-vote.cast_commitment` checks that a
 * submitted commitment equals the admin-set root and that the nullifier is
 * unused, but it cannot check a Merkle path (RFC §5, phase 4a). Until a ZK
 * verifier exists the mode stays `commitment_v1` and the SDK reports such
 * ballots as UNVERIFIED_COMMITMENT. This module does not change that.
 *
 * Every hash here is length-prefixed or domain-separated, so two different
 * inputs can never collide by concatenation ambiguity (e.g. secret "ab" +
 * attrs "c" vs secret "a" + attrs "bc").
 */

import { concatBytes, sha256Bytes, utf8Bytes } from "./hash.js";

/** 32-byte hex, lowercase. */
export type Hex32 = string;

// Domain separators. Changing one of these changes every derived value, so they
// are frozen and versioned rather than inlined at the call sites.
const DOMAIN = {
  commitment: utf8Bytes("brujula-civica/credential-commitment/v1"),
  nullifier: utf8Bytes("brujula-civica/vote-nullifier/v1"),
  merkleLeaf: new Uint8Array([0x00]),
  merkleNode: new Uint8Array([0x01]),
} as const;

/** 8-byte big-endian length prefix. */
function len(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`longitud inválida: ${n}`);
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), false);
  return b;
}

/** Length-prefixed field encoding: unambiguous concatenation. */
function field(bytes: Uint8Array): Uint8Array {
  return concatBytes(len(bytes.length), bytes);
}

function requireHex32(value: string, label: string): Hex32 {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} debe ser un hash hexadecimal de 32 bytes (64 chars)`);
  }
  return value;
}

/**
 * Credential commitment: `H(domain ‖ H(secret) ‖ H(attributes))`.
 *
 * The issuer learns only `commitment`; the chain stores only `commitment`. The
 * secret and the attributes are hashed separately and length-prefixed so the
 * encoding is injective.
 */
export async function commitCredential(args: {
  /** Issuing context, e.g. "municipal/2026/roster". */
  domain: string;
  /** High-entropy secret held only by the subject. */
  secret: string;
  /** Canonical attribute string, e.g. "district=04;role=citizen". */
  attributes: string;
}): Promise<Hex32> {
  const { domain, secret, attributes } = args;
  if (domain.length === 0) throw new Error("domain no puede estar vacío");
  if (secret.length === 0) throw new Error("secret no puede estar vacío");
  const hSecret = await sha256Bytes(utf8Bytes(secret));
  const hAttrs = await sha256Bytes(utf8Bytes(attributes));
  return sha256Bytes(
    concatBytes(
      field(DOMAIN.commitment),
      field(utf8Bytes(domain)),
      // hexToBytes matters here: `field` length-prefixes *bytes*, and handing it
      // the 64-char hex string would hash the ASCII of the digest instead of
      // the digest, silently producing a stable but meaningless commitment.
      field(hexToBytes(hSecret)),
      field(hexToBytes(hAttrs)),
    ),
  );
}

/**
 * Nullifier: `H(voter_secret ‖ proposal_id)`.
 *
 * Per (voter, proposal), which is what makes double-voting detectable without
 * revealing the voter. `proposalId` is bound with a 8-byte big-endian length
 * prefix so it cannot be confused with the secret.
 */
export async function deriveNullifier(args: {
  secret: string;
  proposalId: bigint | number;
}): Promise<Hex32> {
  if (args.secret.length === 0) throw new Error("secret no puede estar vacío");
  if (args.proposalId < 0n && typeof args.proposalId !== "number") {
    throw new Error("proposalId no puede ser negativo");
  }
  const id = BigInt(args.proposalId);
  if (id < 0n) throw new Error("proposalId no puede ser negativo");

  const idBytes = new Uint8Array(8);
  new DataView(idBytes.buffer).setBigUint64(0, id, false);
  const hSecret = await sha256Bytes(utf8Bytes(args.secret));

  return sha256Bytes(
    concatBytes(
      field(DOMAIN.nullifier),
      // Same reasoning as in commitCredential: bytes, not the hex string.
      field(hexToBytes(hSecret)),
      field(idBytes),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Merkle membership                                                    */
/* ------------------------------------------------------------------ */

/** Leaf hash for a commitment, domain-separated from internal nodes. */
export async function merkleLeaf(commitment: Hex32): Promise<Hex32> {
  const raw = new Uint8Array(32);
  for (let i = 0; i < 32; i++) raw[i] = parseInt(commitment.slice(i * 2, i * 2 + 2), 16);
  return sha256Bytes(concatBytes(DOMAIN.merkleLeaf, raw));
}

/** Internal node hash. */
async function merkleNode(left: Hex32, right: Hex32): Promise<Hex32> {
  const raw = concatBytes(hexToBytes(left), hexToBytes(right));
  return sha256Bytes(concatBytes(DOMAIN.merkleNode, raw));
}

function hexToBytes(hex: Hex32): Uint8Array {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return b;
}

export interface MerkleProofStep {
  /** The sibling hash at this level. */
  readonly sibling: Hex32;
  /** Whether the sibling sits on the left, i.e. the subject is in the right. */
  readonly siblingIsLeft: boolean;
}

export interface MerkleTree {
  readonly leaves: readonly Hex32[];
  /** Layers[0] = leaf hashes; the last layer holds the single root. */
  readonly layers: readonly (readonly Hex32[])[];
  readonly root: Hex32;
  /** Sibling path for `index`, bottom-up. */
  proof(index: number): MerkleProofStep[];
}

/**
 * Build a Merkle tree over commitments.
 *
 * Odd nodes at a level are promoted unchanged rather than duplicated. That is
 * the Bitcoin convention: it keeps the tree the same size as the leaf set and
 * avoids the ambiguity of duplicating a node, while still binding every leaf
 * into the root.
 */
export async function buildMerkle(leaves: readonly Hex32[]): Promise<MerkleTree> {
  if (leaves.length === 0) throw new Error("un árbol Merkle necesita al menos una hoja");
  for (const l of leaves) requireHex32(l, "commitment");

  const layers: Hex32[][] = [await Promise.all(leaves.map(merkleLeaf))];
  let current = layers[0]!;

  while (current.length > 1) {
    const next: Hex32[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      const right = current[i + 1];
      next.push(right === undefined ? left : await merkleNode(left, right));
    }
    layers.push(next);
    current = next;
  }

  const root = current[0]!;

  return {
    leaves: [...leaves],
    layers,
    root,
    proof(index: number): MerkleProofStep[] {
      if (!Number.isInteger(index) || index < 0 || index >= leaves.length) {
        throw new Error(`índice de hoja fuera de rango: ${index} (0..${leaves.length - 1})`);
      }
      const steps: MerkleProofStep[] = [];
      let idx = index;
      for (let level = 0; level < layers.length - 1; level++) {
        const layer = layers[level]!;
        const isRight = idx % 2 === 1;
        const siblingIndex = isRight ? idx - 1 : idx + 1;
        const sibling = layer[siblingIndex];
        if (sibling !== undefined) {
          steps.push({ sibling, siblingIsLeft: isRight });
        }
        idx = Math.floor(idx / 2);
      }
      return steps;
    },
  };
}

/** Recompute a root from a leaf and its sibling path. */
export async function computeRootFromProof(
  commitment: Hex32,
  proof: readonly MerkleProofStep[],
): Promise<Hex32> {
  let node = await merkleLeaf(commitment);
  for (const step of proof) {
    node = step.siblingIsLeft
      ? await merkleNode(step.sibling, node)
      : await merkleNode(node, step.sibling);
  }
  return node;
}

/** Verify membership. Used client-side; the chain cannot do this yet (RFC §5). */
export async function verifyMerkleProof(args: {
  root: Hex32;
  commitment: Hex32;
  proof: readonly MerkleProofStep[];
}): Promise<boolean> {
  for (const s of args.proof) requireHex32(s.sibling, "hermano del camino");
  const computed = await computeRootFromProof(args.commitment, args.proof);
  return computed === requireHex32(args.root, "root");
}

