/**
 * CivicSys SDK — fail-closed read envelopes and domain views.
 *
 * Fail-closed rule (RFC CIVICSYS-ARCH-001 §0/§6): whenever state cannot be
 * read or parsed from the chain, the SDK returns `status: "unknown"` with a
 * reason. It never fabricates defaults, zeros, or optimistic values.
 */

/** Where a value came from, when it came from the chain. */
export interface Evidence {
  contractId: string;
  rpcUrl: string;
  fetchedAt: string; // ISO-8601 UTC
  ledger: number | null;
}

/** A successful read: the chain answered, this is exactly what it said. */
export interface OkRead<T> {
  status: "ok";
  value: T;
  evidence: Evidence;
}

/** An unsuccessful read: no claim about chain state may be made. */
export interface UnknownRead {
  status: "unknown";
  reason: string;
  evidence: {
    contractId: string;
    rpcUrl: string;
    fetchedAt: string;
    ledger?: number | null;
  };
}

export type Read<T> = OkRead<T> | UnknownRead;

export function isOk<T>(r: Read<T>): r is OkRead<T> {
  return r.status === "ok";
}

/** Mirrors on-chain `Credential` (civic-identity §3.1). */
export interface CredentialView {
  subject: string;
  commitment: string; // hex
  credential_type: string;
  status: number; // 0 ACTIVE, 1 SUSPENDED, 2 REVOKED
  eligible: boolean;
  issued_at: bigint;
  updated_at: bigint;
}

export const CREDENTIAL_STATUS = {
  ACTIVE: 0,
  SUSPENDED: 1,
  REVOKED: 2,
} as const;

/** Mirrors on-chain `Proposal` (civic-proposal §3.2). */
export interface ProposalView {
  id: bigint;
  proposer: string;
  title_hash: string; // hex
  description_hash: string;
  metadata_hash: string;
  content_cid: string;
  evidence_root: string;
  created_at: bigint;
  opens_at: bigint;
  closes_at: bigint;
  cancelled: boolean;
  cancel_reason_hash: string | null;
  evidence: string[]; // hex hashes
}

/** Computed proposal status (never stored on-chain — RFC §1). */
export const PROPOSAL_STATUS = {
  SCHEDULED: 0,
  OPEN: 1,
  CLOSED: 2,
  CANCELLED: 3,
} as const;

export const PROPOSAL_STATUS_LABEL = ["SCHEDULED", "OPEN", "CLOSED", "CANCELLED"] as const;

/** Mirrors on-chain `Tally` (civic-vote §3.3). */
export interface TallyView {
  proposal_id: bigint;
  total: bigint;
  counts: Map<number, bigint>;
  public_votes: bigint;
  commitment_votes: bigint;
  /**
   * Strongest verification mode present. v0.1 may only ever be
   * `public_v1` or `commitment_v1` — `zk_*` requires a deployed verifier
   * (Phase 4) and is reported as unproven until then.
   */
  verification_mode: string;
}

/** Mirrors on-chain `Report` (civic-accountability §3.4). */
export interface ReportView {
  id: bigint;
  proposal_id: bigint;
  report_hash: string;
  evidence_hash: string;
  kind: string;
  author: string;
  anchored_at: bigint;
}

/** Deployment evidence record (deployments/<network>.json schema @1). */
export interface DeploymentRecord {
  schema: string;
  network: string;
  network_passphrase: string;
  source_account: string;
  generated_at: string;
  toolchain?: Record<string, string>;
  contracts: Record<
    string,
    {
      version: string;
      contract_id: string;
      deploy_tx: string;
      deploy_ledger: string | null;
      wasm_sha256: string;
    }
  >;
}

export const CONTRACT_NAMES = [
  "civic-identity",
  "civic-proposal",
  "civic-vote",
  "civic-accountability",
] as const;
export type ContractName = (typeof CONTRACT_NAMES)[number];
