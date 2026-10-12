/**
 * Off-chain content verification.
 *
 * One implementation, used by the proposal detail AND by the demo status panel.
 * Duplicating it would let one of the two drift until the UI says VERIFIED
 * while the panel counts the same object as broken, which is exactly the sort
 * of quiet divergence this project exists to avoid.
 *
 * The rule the whole module enforces: a gateway response is never proof. The
 * object must parse, match the schema, and its three digests must equal the
 * ones anchored in Soroban. Anything else is MISMATCH or UNKNOWN.
 */

import { sha256Utf8, type ProposalView } from "@brugulacivica/sdk";

export type ContentVerdict =
  | { status: "loading" }
  | { status: "verified"; title: string; description: string; metadata: string }
  | { status: "mismatch"; reason: string }
  | { status: "unknown"; reason: string };

/** Public gateways, tried in order, each with the same timeout. */
const GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
] as const;

/** Same ceiling the pinning function enforces, so a viewer cannot be fed more. */
const MAX_CONTENT_BYTES = 64 * 1024;
const GATEWAY_TIMEOUT_MS = 12_000;

function validCid(cid: string): boolean {
  return /^b[a-z2-7]{20,}$/.test(cid) || /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid);
}

/** Shape the pinned object must have, and that the composer produces. */
interface ProposalContentV1 {
  schema: string;
  title: string;
  description: string;
  metadata: string;
  created_at: string;
}

const SCHEMA = "brujula-civica/proposal-content@1";

/**
 * Fetches the object behind `content_cid` and checks its digests against the
 * chain. Returns UNKNOWN when the content simply cannot be reached — which is
 * not the same as it being wrong.
 */
export async function verifyProposalContent(
  proposal: Pick<ProposalView, "content_cid" | "title_hash" | "description_hash" | "metadata_hash">,
): Promise<ContentVerdict> {
  if (!validCid(proposal.content_cid)) {
    return { status: "unknown", reason: "El CID anclado no tiene un formato reconocible." };
  }

  let lastError = "No hubo respuesta de las pasarelas IPFS.";
  for (const gateway of GATEWAYS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
    try {
      const response = await fetch(`${gateway}${encodeURIComponent(proposal.content_cid)}`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        lastError = `Pasarela IPFS respondió HTTP ${response.status}.`;
        continue;
      }
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > MAX_CONTENT_BYTES) {
        return {
          status: "mismatch",
          reason: "El contenido supera el límite admitido de 64 KiB.",
        };
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        return { status: "mismatch", reason: "El CID no contiene JSON válido." };
      }
      if (!payload || typeof payload !== "object") {
        return {
          status: "mismatch",
          reason: "El objeto IPFS no tiene el formato de propuesta esperado.",
        };
      }
      const p = payload as Record<string, unknown>;
      if (
        p.schema !== SCHEMA ||
        typeof p.title !== "string" ||
        typeof p.description !== "string" ||
        typeof p.metadata !== "string" ||
        typeof p.created_at !== "string"
      ) {
        return {
          status: "mismatch",
          reason: "El contenido no cumple brujula-civica/proposal-content@1.",
        };
      }
      const c = p as unknown as ProposalContentV1;

      const [titleHash, descriptionHash, metadataHash] = await Promise.all([
        sha256Utf8(c.title),
        sha256Utf8(c.description),
        sha256Utf8(c.metadata),
      ]);
      const matches =
        titleHash.toLowerCase() === proposal.title_hash.toLowerCase() &&
        descriptionHash.toLowerCase() === proposal.description_hash.toLowerCase() &&
        metadataHash.toLowerCase() === proposal.metadata_hash.toLowerCase();
      if (!matches) {
        return {
          status: "mismatch",
          reason:
            "Uno o más hashes del contenido recuperado no coinciden con los hashes anclados en Stellar.",
        };
      }
      return { status: "verified", title: c.title, description: c.description, metadata: c.metadata };
    } catch (error) {
      lastError =
        error instanceof Error && error.name === "AbortError"
          ? "La pasarela IPFS agotó el tiempo de espera."
          : error instanceof Error
            ? error.message
            : String(error);
    } finally {
      clearTimeout(timeout);
    }
  }
  return { status: "unknown", reason: lastError };
}

export { SCHEMA as PROPOSAL_CONTENT_SCHEMA };
