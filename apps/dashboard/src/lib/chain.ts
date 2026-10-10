/**
 * Chain access for the Brújula Cívica dashboard.
 *
 * Every value returned here is either
 *   - `status: "ok"`    — the chain answered exactly this, or
 *   - `status: "unknown"` — no claim about chain state can be made.
 *
 * There is no third state and no fallback default (RFC BRUJULA-CIVICA-ARCH-001 §0).
 * Views must render `UNKNOWN` for the unknown case rather than substituting a zero.
 */

import {
  BrujulaReader,
  parseDeployment,
  rpcUrlFromEnv,
  type CredentialView,
  type Evidence,
  type ProposalView,
  type Read,
  type ReportView,
  type TallyView,
  type VerificationResult,
} from "@brugulacivica/sdk";
import deploymentRaw from "../../../../deployments/testnet.json";
import { rpc } from "@stellar/stellar-sdk";

// Throws at import time if the evidence record is malformed. That is intended:
// an unprovable deployment must never boot a dashboard that claims to verify it.
export const deployment = parseDeployment(deploymentRaw);

/**
 * The RPC endpoint every read and every write goes through.
 *
 * `VITE_BRUJULA_CIVICA_RPC_URL` overrides it at build time; otherwise the SDK's
 * env-aware default (testnet public RPC) applies. Always a concrete string —
 * the contract `Client` requires one and must not silently pick its own.
 */
export const RPC_URL: string =
  (import.meta.env["VITE_BRUJULA_CIVICA_RPC_URL"] as string | undefined) ||
  rpcUrlFromEnv();

export const reader = new BrujulaReader(deployment, RPC_URL);

/**
 * The live ledger sequence, for the header ticker.
 *
 * Returns null when the RPC cannot be reached — the UI then shows
 * DESCONOCIDO, never a hardcoded block number.
 */
export async function fetchLatestLedger(): Promise<number | null> {
  try {
    const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http:") });
    const { sequence } = await server.getLatestLedger();
    return typeof sequence === "number" ? sequence : null;
  } catch {
    return null;
  }
}

export type { CredentialView, Evidence, ProposalView, Read, ReportView, TallyView };

export type ReportEntry = { id: bigint; report: Read<ReportView | null> };

export type ProposalRow = {
  id: bigint;
  proposal: Read<ProposalView | null>;
  status: Read<number>;
};

/** Aggregate numbers shown on the landing page. All chain-derived or UNKNOWN. */
export type PublicStats = {
  proposals: Read<bigint>;
  anchoredReports: Read<bigint>;
};

/**
 * Cheap O(1) stats for the landing page.
 *
 * Deliberately does NOT include an "open proposals" count: that needs one
 * `status` query per proposal. The dashboard derives per-card status from the
 * rows it has already loaded, so nothing here is recomputed or faked.
 */
export async function fetchPublicStats(): Promise<PublicStats> {
  const [proposals, anchoredReports] = await Promise.all([
    reader.nextProposalId(),
    reader.reportCount(),
  ]);

  // `next_id` is the id the *next* proposal will get, so the total created is
  // `next_id - 1`. Guard against the impossible underflow rather than trusting it.
  const total: Read<bigint> =
    proposals.status === "ok" && proposals.value > 0n
      ? { status: "ok", value: proposals.value - 1n, evidence: proposals.evidence }
      : proposals;

  return { proposals: total, anchoredReports };
}

/**
 * Load proposals 1..nextId-1, newest id last.
 *
 * Reads are sequential on purpose: the public testnet RPC rate-limits, and a
 * burst of parallel `queryContract` calls turns every read into `unknown`.
 */
export async function fetchProposalRows(
  maxCount = 25,
): Promise<{ nextId: Read<bigint>; rows: ProposalRow[]; loadedCount: number }> {
  const nextId = await reader.nextProposalId();
  if (nextId.status !== "ok") return { nextId, rows: [], loadedCount: 0 };

  const total = nextId.value > 0n ? nextId.value - 1n : 0n;
  // Newest first, so the cap keeps the most relevant proposals.
  const upper = Number(total);
  const first = Math.max(1, upper - maxCount + 1);
  const rows: ProposalRow[] = [];

  for (let i = upper; i >= first && i >= 1; i--) {
    const id = BigInt(i);
    const proposal = await reader.getProposal(id);
    const status = await reader.proposalStatus(id);
    rows.push({ id, proposal, status });
  }

  return { nextId, rows, loadedCount: rows.length };
}

/** Anchored accountability reports, newest id first. Fail-closed on any gap. */
export async function fetchReports(maxCount = 10): Promise<{
  count: Read<bigint>;
  reports: { id: bigint; report: Read<ReportView | null> }[];
}> {
  const count = await reader.reportCount();
  if (count.status !== "ok") return { count, reports: [] };

  const total = Number(count.value);
  const reports: { id: bigint; report: Read<ReportView | null> }[] = [];
  for (let i = total; i >= Math.max(1, total - maxCount + 1) && i >= 1; i--) {
    const id = BigInt(i);
    reports.push({ id, report: await reader.getReport(id) });
  }
  return { count, reports };
}

export async function fetchTally(
  proposalId: bigint,
): Promise<Read<VerificationResult>> {
  return reader.verifyTally(proposalId);
}

/** Full credential lookup for an address: the record plus the derived verdict. */
export async function fetchCredential(address: string): Promise<{
  credential: Read<CredentialView | null>;
  eligible: Read<boolean>;
}> {
  const [credential, eligible] = await Promise.all([
    reader.getCredential(address),
    reader.isEligible(address),
  ]);
  return { credential, eligible };
}