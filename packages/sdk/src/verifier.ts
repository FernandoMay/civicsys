/**
 * Fail-closed verification of an on-chain tally.
 * Source of truth: RFC CIVICSYS-ARCH-001 §3.3 / §6.
 *
 * Pure functions — no I/O — so every rule is unit-testable and deterministic.
 */

import type { TallyView } from "./types.js";

export type CheckState = true | false | "unknown";

export interface Check {
  id: string;
  state: CheckState;
  detail: string;
}

export type Verdict = "verified" | "mismatch" | "unknown";

export interface VerificationResult {
  verdict: Verdict;
  checks: Check[];
  tally: TallyView | null;
  /** verification_mode of the tally, or null when no tally exists. */
  mode: string | null;
}

/** Modes v0.1 can honestly claim (RFC §5: no `zk_*` without a verifier). */
export const KNOWN_MODES = ["public_v1", "commitment_v1"] as const;

export interface VerifyOptions {
  /**
   * Only set true when a ZK verifier contract is deployed AND its address is
   * recorded in verified deployment evidence. Default false: `zk_*` modes are
   * reported as `unknown`, never as verified anonymity (RFC §0.2/§5).
   */
  zkVerifierDeployed?: boolean;
}

function isNonNegIntKey(k: unknown): k is number {
  return typeof k === "number" && Number.isInteger(k) && k >= 0;
}

/**
 * Verify internal consistency of a tally read from the chain.
 *
 * - `verified`: every deterministic rule holds.
 * - `mismatch`: at least one rule demonstrably fails (tampering/corruption).
 * - `unknown`: no tally exists, or a property cannot be proven yet (e.g. a
 *   `zk_*` mode without a verified verifier). NEVER reported as verified.
 */
export function verifyTally(
  tally: TallyView | null,
  opts: VerifyOptions = {},
): VerificationResult {
  if (tally === null) {
    return {
      verdict: "unknown",
      checks: [
        {
          id: "tally_exists",
          state: "unknown",
          detail: "no tally recorded on-chain for this proposal",
        },
      ],
      tally: null,
      mode: null,
    };
  }

  const checks: Check[] = [];
  const mode = String(tally.verification_mode);

  // 1. mode must be one this version can honestly claim
  if ((KNOWN_MODES as readonly string[]).includes(mode)) {
    checks.push({ id: "mode_recognized", state: true, detail: `mode=${mode}` });
  } else if (mode.startsWith("zk_")) {
    checks.push({
      id: "mode_recognized",
      state: opts.zkVerifierDeployed ? "unknown" : "unknown",
      detail: opts.zkVerifierDeployed
        ? `mode=${mode}: verifier deployed but anonymity not independently verified`
        : `mode=${mode}: no verified ZK verifier exists yet (RFC §5) — cannot claim anonymity`,
    });
  } else {
    checks.push({
      id: "mode_recognized",
      state: false,
      detail: `mode=${mode} is not a known CivicSys verification mode`,
    });
  }

  // 2. counts must be well-formed
  let countsOk = true;
  let countsDetail = "";
  let sum = 0n;
  for (const [k, v] of tally.counts) {
    if (!isNonNegIntKey(k) || typeof v !== "bigint" || v < 0n) {
      countsOk = false;
      countsDetail = `invalid count entry ${String(k)} => ${String(v)}`;
      break;
    }
    sum += v;
  }
  checks.push({
    id: "counts_well_formed",
    state: countsOk,
    detail: countsOk ? `${tally.counts.size} choice buckets` : countsDetail,
  });

  // 3. total == sum(counts)
  if (countsOk) {
    checks.push({
      id: "total_equals_sum_counts",
      state: sum === tally.total,
      detail: `sum(counts)=${sum} total=${tally.total}`,
    });
  }

  // 4. total == public + commitment
  checks.push({
    id: "total_equals_mode_split",
    state: tally.public_votes + tally.commitment_votes === tally.total,
    detail: `public=${tally.public_votes} commitment=${tally.commitment_votes} total=${tally.total}`,
  });

  // 5. mode must be consistent with the split
  if (mode === "public_v1") {
    checks.push({
      id: "mode_consistent_with_split",
      state: tally.commitment_votes === 0n,
      detail:
        tally.commitment_votes === 0n
          ? "public mode with zero commitment ballots"
          : `public_v1 but commitment_votes=${tally.commitment_votes}`,
    });
  } else if (mode === "commitment_v1") {
    checks.push({
      id: "mode_consistent_with_split",
      state: tally.commitment_votes > 0n,
      detail:
        tally.commitment_votes > 0n
          ? "commitment mode with commitment ballots present"
          : "commitment_v1 but commitment_votes=0",
    });
  } else {
    checks.push({
      id: "mode_consistent_with_split",
      state: "unknown",
      detail: "cannot assess split consistency for unproven mode",
    });
  }

  // 6. no negative tallies
  const nonNegative =
    tally.total >= 0n && tally.public_votes >= 0n && tally.commitment_votes >= 0n;
  checks.push({
    id: "votes_non_negative",
    state: nonNegative,
    detail: nonNegative ? "all values >= 0" : "negative value detected",
  });

  const verdict: Verdict = checks.some((c) => c.state === false)
    ? "mismatch"
    : checks.some((c) => c.state === "unknown")
      ? "unknown"
      : "verified";

  return { verdict, checks, tally, mode };
}
