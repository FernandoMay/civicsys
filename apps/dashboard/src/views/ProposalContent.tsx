import { useEffect, useState } from "react";

import { sha256Utf8 } from "@brugulacivica/sdk";
import type { ProposalView } from "../lib/chain.js";

type ContentState =
  | { status: "loading" }
  | { status: "verified"; title: string; description: string; metadata: string }
  | { status: "mismatch"; reason: string }
  | { status: "unknown"; reason: string };

const GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
] as const;

function validCid(cid: string): boolean {
  return /^b[a-z2-7]{20,}$/.test(cid) || /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid);
}

/**
 * Reads the off-chain JSON and independently compares its title, description
 * and metadata digests with the values anchored in Soroban. A gateway response
 * alone is never considered proof of integrity.
 */
export default function ProposalContent({ proposal }: { proposal: ProposalView }) {
  const [state, setState] = useState<ContentState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!validCid(proposal.content_cid)) {
        setState({ status: "unknown", reason: "El CID anclado no tiene un formato reconocible." });
        return;
      }
      setState({ status: "loading" });
      let lastError = "No hubo respuesta de las pasarelas IPFS.";
      for (const gateway of GATEWAYS) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12_000);
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
          if (new TextEncoder().encode(text).byteLength > 64 * 1024) {
            setState({ status: "mismatch", reason: "El contenido supera el límite admitido de 64 KiB." });
            return;
          }
          let payload: unknown;
          try {
            payload = JSON.parse(text);
          } catch {
            setState({ status: "mismatch", reason: "El CID no contiene JSON válido." });
            return;
          }
          if (!payload || typeof payload !== "object") {
            setState({ status: "mismatch", reason: "El objeto IPFS no tiene el formato de propuesta esperado." });
            return;
          }
          const p = payload as Record<string, unknown>;
          if (
            p.schema !== "brujula-civica/proposal-content@1" ||
            typeof p.title !== "string" ||
            typeof p.description !== "string" ||
            typeof p.metadata !== "string" ||
            typeof p.created_at !== "string"
          ) {
            setState({ status: "mismatch", reason: "El contenido no cumple brujula-civica/proposal-content@1." });
            return;
          }

          const [titleHash, descriptionHash, metadataHash] = await Promise.all([
            sha256Utf8(p.title),
            sha256Utf8(p.description),
            sha256Utf8(p.metadata),
          ]);
          const matches =
            titleHash.toLowerCase() === proposal.title_hash.toLowerCase() &&
            descriptionHash.toLowerCase() === proposal.description_hash.toLowerCase() &&
            metadataHash.toLowerCase() === proposal.metadata_hash.toLowerCase();
          if (!matches) {
            setState({
              status: "mismatch",
              reason: "Uno o más hashes del contenido recuperado no coinciden con los hashes anclados en Stellar.",
            });
            return;
          }
          if (!cancelled) setState({ status: "verified", title: p.title, description: p.description, metadata: p.metadata });
          return;
        } catch (error) {
          lastError = error instanceof Error && error.name === "AbortError"
            ? "La pasarela IPFS agotó el tiempo de espera."
            : error instanceof Error ? error.message : String(error);
        } finally {
          clearTimeout(timeout);
        }
      }
      if (!cancelled) setState({ status: "unknown", reason: lastError });
    };
    void load();
    return () => { cancelled = true; };
  }, [proposal.content_cid, proposal.title_hash, proposal.description_hash, proposal.metadata_hash]);

  return (
    <div className="mt-space-md space-y-space-sm" aria-live="polite">
      {state.status === "loading" ? (
        <p className="font-code-sm text-code-sm text-outline">[PENDING] Recuperando contenido IPFS y comprobando hashes…</p>
      ) : state.status === "unknown" ? (
        <div className="p-space-sm bg-surface-container-low">
          <p className="font-code-sm text-code-sm text-outline font-semibold">[UNKNOWN] Contenido no verificable</p>
          <p className="font-body-sm text-body-sm text-on-surface-variant">{state.reason}</p>
        </div>
      ) : state.status === "mismatch" ? (
        <div className="p-space-sm bg-error-container text-on-error-container">
          <p className="font-code-sm text-code-sm font-semibold">[MISMATCH] Integridad no demostrada</p>
          <p className="font-body-sm text-body-sm">{state.reason}</p>
        </div>
      ) : (
        <div className="p-space-md bg-surface-container-lowest border border-primary space-y-space-sm">
          <p className="font-code-sm text-code-sm text-primary font-semibold">[VERIFIED] Hashes de contenido coinciden</p>
          <h3 className="font-headline-md text-headline-md text-on-surface">{state.title}</h3>
          <p className="font-body-md text-body-md text-on-surface whitespace-pre-wrap">{state.description}</p>
          <details>
            <summary className="font-code-sm text-code-sm text-outline cursor-pointer">Ver metadatos anclados</summary>
            <pre className="mt-space-xs whitespace-pre-wrap break-words font-code-sm text-code-sm text-on-surface">{state.metadata}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
