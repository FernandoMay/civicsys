import { useEffect, useRef, useState } from "react";

import type { ProposalRow } from "../lib/chain.js";
import { verifyProposalContent, type ContentVerdict } from "../lib/content.js";

type Counts = {
  verified: number;
  unverifiable: number;
  pending: number;
};

const EMPTY: Counts = { verified: 0, unverifiable: 0, pending: 0 };

/**
 * Counts how many of the listed proposals have content a reader can actually
 * open and check.
 *
 * The demo status panel has to state this from evidence rather than from
 * memory, because the honest answer changes the moment real content is
 * published. Verification runs one proposal at a time: a burst would hit the
 * gateway rate limits and report UNKNOWN for content that is perfectly fine.
 */
export function useContentVerdicts(rows: ProposalRow[]): Counts {
  const [counts, setCounts] = useState<Counts>(EMPTY);
  // A run is only relevant if the rows it started for are still on screen.
  const runId = useRef(0);

  useEffect(() => {
    const mine = ++runId.current;
    // Only proposals the chain actually returned can be checked. Everything
    // else is already reported honestly by the grid itself.
    const candidates = rows.flatMap((row) => {
      const read = row.proposal;
      return read.status === "ok" && read.value !== null ? [read.value] : [];
    });

    if (candidates.length === 0) {
      setCounts(EMPTY);
      return;
    }

    let cancelled = false;
    setCounts({ verified: 0, unverifiable: 0, pending: candidates.length });

    void (async () => {
      for (const proposal of candidates) {
        const verdict: ContentVerdict = await verifyProposalContent(proposal);
        if (cancelled || mine !== runId.current) return;
        setCounts((prev) => ({
          verified: prev.verified + (verdict.status === "verified" ? 1 : 0),
          unverifiable: prev.unverifiable + (verdict.status === "verified" ? 0 : 1),
          pending: Math.max(0, prev.pending - 1),
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rows]);

  return counts;
}
