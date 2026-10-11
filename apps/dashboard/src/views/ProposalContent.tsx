import { useEffect, useState } from "react";

import type { ProposalView } from "@brugulacivica/sdk";

import { verifyProposalContent } from "../lib/content.js";

/**
 * Reads the off-chain JSON and independently compares its title, description
 * and metadata digests with the values anchored in Soroban. A gateway response
 * alone is never considered proof of integrity.
 *
 * The verification itself lives in lib/content.ts so the demo status panel
 * counts the same objects by the same rules.
 */
export default function ProposalContent({ proposal }: { proposal: ProposalView }) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "verified"; title: string; description: string; metadata: string }
    | { status: "mismatch"; reason: string }
    | { status: "unknown"; reason: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const verdict = await verifyProposalContent(proposal);
      if (cancelled) return;
      setState(verdict);
    })();
    return () => {
      cancelled = true;
    };
  }, [proposal]);

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
