/**
 * Commitment ballot flow, in the browser.
 *
 * Implements the client half of `commitment_v1` (RFC BRUJULA-CIVICA-ARCH-001
 * §5, phase 4a): derive a commitment, derive a nullifier, and submit both.
 *
 * The hard truth this module exists to preserve: the contract cannot verify a
 * Merkle path. `cast_commitment` checks the commitment equals the admin-published
 * root and that the nullifier is unused. So the voter is told, in the UI, that
 * the ballot is UNVERIFIED_COMMITMENT — never anonymous, never ZK.
 *
 * The voter's secret is generated locally with WebCrypto and never leaves the
 * browser except as its derived hash.
 */

import { deriveNullifier } from "@brugulacivica/sdk";

/** 32 random bytes as lowercase hex. Uses WebCrypto, present in all browsers. */
export async function generateVoterSecret(): Promise<string> {
  const buf = new Uint8Array(32);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.getRandomValues) {
    throw new Error(
      "WebCrypto (crypto.getRandomValues) no está disponible en este navegador",
    );
  }
  c.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * What a commitment ballot needs before it can be submitted.
 *
 * Returns the derived values plus a blocking reason when the proposal has no
 * published membership root — because without one the contract rejects the call
 * with `RootNotSet`, and we would rather say so than let the user sign a tx
 * that cannot succeed.
 */
export async function prepareCommitmentBallot(args: {
  secret: string;
  proposalId: bigint;
  choice: number;
  /** Root published by the admin, or null when none exists. */
  membershipRoot: string | null;
  /** Domain + attributes must match how the admin built the tree. */
  domain: string;
  attributes: string;
}): Promise<
  | {
      ok: true;
      commitment: string;
      nullifier: string;
      membershipRoot: string;
    }
  | { ok: false; reason: string }
> {
  const { secret, proposalId, membershipRoot, domain, attributes } = args;
  if (!secret) return { ok: false, reason: "falta el secreto del votante" };
  if (!membershipRoot) {
    return {
      ok: false,
      reason:
        "ningún administrador publicó una raíz de membresía para esta propuesta: el contrato rechazaría la boleta (RootNotSet)",
    };
  }

  // Imported lazily so the commitment helper is only pulled in when a
  // commitment ballot is actually attempted.
  const { commitCredential } = await import("@brugulacivica/sdk");

  const commitment = await commitCredential({ domain, secret, attributes });
  const nullifier = await deriveNullifier({ secret, proposalId });
  return { ok: true, commitment, nullifier, membershipRoot };
}

/**
 * Honest label for a tally that contains commitment ballots.
 *
 * Two things stay true and both must be said: the tally is keyed by nullifier
 * rather than address, AND the membership of the voter is not proven on chain.
 * The transaction that carried the ballot still has a visible source account,
 * so this is not anonymity — the UI must not imply otherwise.
 */
export function commitmentDisclosure(mode: string | null): string {
  switch (mode) {
    case "commitment_v1":
      return (
        "UNVERIFIED_COMMITMENT — el recuento se indexa por nullificador y no guarda tu " +
        "dirección, pero (a) la pertenencia al padrón NO está probada en cadena y " +
        "(b) la transacción que enviaste sigue teniendo una cuenta origen visible. " +
        "No es anonimato."
      );
    case "public_v1":
      return "PUBLIC_V1 — voto público y firmado por la cartera. Transparente, no anónimo.";
    case null:
      return "DESCONOCIDO — no hay recuento en cadena.";
    default:
      return `Modo ${mode}: no reconocemos este modo, no afirmamos nada sobre él.`;
  }
}