/**
 * Hermes evidence domain types.
 *
 * RFC BRUJULA-CIVICA-ARCH-001 §6 fixes the vocabulary. These types encode that
 * vocabulary in the type system so a rule physically cannot emit something the
 * RFC forbids:
 *
 *   - the status union has exactly four members, and `TRUE` is not one of them;
 *   - a `Source` records what was actually retrieved, including failure;
 *   - a `Claim` must carry its sources and the id of the rule that judged it.
 */

/**
 * Claim/report status. Fixed vocabulary (RFC §6).
 *
 * `TRUE` is intentionally absent: Hermes never asserts that a claim is true, it
 * asserts that a claim is *supported* by named sources under a named rule.
 */
export type ClaimStatus = "SUPPORTED" | "CONTRADICTED" | "UNVERIFIED" | "UNKNOWN";

export const CLAIM_STATUSES: readonly ClaimStatus[] = [
  "SUPPORTED",
  "CONTRADICTED",
  "UNVERIFIED",
  "UNKNOWN",
];

/** Outcome of retrieving one source. Failure is recorded, never hidden. */
export type RetrievalStatus =
  | "RETRIEVED"
  | "HTTP_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "TOO_LARGE"
  | "UNSUPPORTED_TYPE";

export interface RetrievedSource {
  /** The URL exactly as requested, before any redirect. */
  readonly url: string;
  /** Final URL after redirects, or the requested URL when there were none. */
  readonly finalUrl: string;
  readonly status: RetrievalStatus;
  readonly httpStatus: number | null;
  /** RFC 1123 date string, or null when the retrieval failed before headers. */
  readonly retrievedAt: string | null;
  /**
   * Lowercase hex SHA-256 of the response body, or null when nothing was
   * retrieved. Present precisely when `status === "RETRIEVED"`.
   */
  readonly contentHash: string | null;
  /** Decoded body, retained for rule evaluation. Null on failure. */
  readonly text: string | null;
  readonly contentType: string | null;
  readonly byteLength: number | null;
  /** Populated when `status !== "RETRIEVED"`, so failures are explainable. */
  readonly error: string | null;
}

/** The canonical, hashable evidence set. Field order here is irrelevant: the
 *  canonical serializer sorts keys (see `canonical.ts`). */
export interface EvidenceSet {
  readonly subject: string;
  readonly sources: readonly RetrievedSource[];
}

/**
 * A deterministic rule that judges one claim about the evidence set.
 *
 * A rule must be a pure function of the evidence set. It receives no clock and
 * no network: retrieval has already happened, so re-running the same evidence
 * set always yields the same verdicts.
 */
export interface ClaimRule {
  readonly id: string;
  readonly description: string;
  /** Unique string that the rule searches for in source bodies. */
  readonly claim: string;
  /**
   * Distinct sources that must independently contain the claim string for it
   * to be SUPPORTED. `1` means "at least one retrieved source says it".
   */
  readonly minSources?: number;
}

export interface ClaimFinding {
  readonly claim: string;
  readonly status: ClaimStatus;
  /** The rule that produced this status. Never empty. */
  readonly ruleId: string;
  readonly ruleDescription: string;
  /** Indices into `EvidenceSet.sources`, in ascending order. */
  readonly matchedSourceIndices: number[];
  /** How many sources were actually retrieved (denominator). */
  readonly retrievedSourceCount: number;
  readonly detail: string;
}

export interface HermesReport {
  readonly subject: string;
  readonly findings: readonly ClaimFinding[];
  /**
   * Aggregate roll-up. Worst status wins, so one CONTRADICTED finding cannot be
   * averaged away by many SUPPORTED ones.
   */
  readonly overallStatus: ClaimStatus;
  /** `H(canonical JSON of the evidence set)` — the value anchored on chain. */
  readonly evidenceHash: string;
  /** `H(canonical JSON of the report body)` — the value anchored on chain. */
  readonly reportHash: string;
  readonly generatedAt: string;
  /** Number of sources that failed to retrieve. Surfaced, never omitted. */
  readonly failedSourceCount: number;
}