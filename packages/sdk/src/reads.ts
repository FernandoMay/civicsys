/**
 * Fail-closed chain reads for the CivicSys contracts.
 *
 * Every method returns Read<T>: `ok` means the chain answered exactly this;
 * `unknown` means we could make NO claim about chain state (RFC §0). There is
 * no code path that fabricates a default value.
 */

import { rpc } from "@stellar/stellar-sdk";
import type {
  ContractName,
  CredentialView,
  DeploymentRecord,
  Evidence,
  ProposalView,
  Read,
  ReportView,
  TallyView,
} from "./types.js";
import { rpcUrlFromEnv } from "./config.js";
import { verifyTally, type VerificationResult, type VerifyOptions } from "./verifier.js";

/* ------------------------------------------------------------------ */
/* normalization helpers (unexpected shapes => throw => unknown)       */
/* ------------------------------------------------------------------ */

function hexOf(v: unknown): string {
  if (typeof v === "string") {
    if (/^(0x)?[0-9a-fA-F]+$/.test(v) && v.length >= 2) {
      return v.startsWith("0x") ? v.slice(2) : v;
    }
    throw new Error(`expected hex bytes, got ${JSON.stringify(v)}`);
  }
  if (v instanceof Uint8Array) {
    // browser-safe hex (no Buffer dependency)
    return Array.from(v, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  throw new Error(`expected bytes, got ${typeof v}`);
}

function hexOr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return hexOf(v);
}

function big(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  throw new Error(`expected integer, got ${typeof v}: ${String(v)}`);
}

function str(v: unknown): string {
  if (typeof v === "string") return v;
  throw new Error(`expected string, got ${typeof v}`);
}

function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  throw new Error(`expected boolean, got ${typeof v}`);
}

/** Accepts JS Map | object | [[k,v],...] and normalizes to Map<number, bigint>. */
export function toCounts(v: unknown): Map<number, bigint> {
  const out = new Map<number, bigint>();
  const add = (k: unknown, val: unknown) => {
    const n = typeof k === "string" ? Number(k) : k;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
      throw new Error(`invalid count key ${String(k)}`);
    }
    out.set(n, big(val));
  };
  if (v instanceof Map) {
    for (const [k, val] of v) add(k, val);
    return out;
  }
  if (Array.isArray(v)) {
    for (const pair of v) {
      if (Array.isArray(pair) && pair.length === 2) add(pair[0], pair[1]);
      else throw new Error("invalid counts pair");
    }
    return out;
  }
  if (typeof v === "object" && v !== null) {
    for (const [k, val] of Object.entries(v)) add(k, val);
    return out;
  }
  throw new Error(`unrecognized counts shape: ${typeof v}`);
}

function arrOfStr(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map((x) => hexOf(x));
  throw new Error(`expected array, got ${typeof v}`);
}

/**
 * Normalize a `queryContract` result to the bare value:
 * - some SDK paths return `{ retval }`;
 * - functions declared `-> Result<T, E>` come back wrapped as `Ok { value }`
 *   (verified empirically against the deployed contracts). Duck-typed on the
 *   single `value` key so it survives bundle minification (no class names).
 *   None of the CivicSys contract structs has a lone `value` field.
 */
function unwrap(result: unknown): unknown {
  if (result !== null && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if ("retval" in r) return r.retval;
    const keys = Object.keys(r);
    if (keys.length === 1 && keys[0] === "value") return r.value;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* reader                                                              */
/* ------------------------------------------------------------------ */

export class CivicReader {
  readonly record: DeploymentRecord;
  readonly rpcUrl: string;
  private readonly server: rpc.Server;

  constructor(record: DeploymentRecord, rpcUrl: string = rpcUrlFromEnv()) {
    this.record = record;
    this.rpcUrl = rpcUrl;
    this.server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http:") });
  }

  contractId(name: ContractName): string {
    const c = this.record.contracts[name];
    if (!c) throw new Error(`deployment record missing contract ${name}`);
    return c.contract_id;
  }

  /** `admin()` on any of the four contracts (identity check that it answers). */
  admin(name: ContractName): Promise<Read<string>> {
    return this.read(name, "admin", {}, str);
  }

  private async read<T>(
    name: ContractName,
    method: string,
    args: Record<string, unknown>,
    normalize: (raw: unknown) => T,
  ): Promise<Read<T>> {
    const contractId = this.contractId(name);
    const fetchedAt = new Date().toISOString();
    try {
      const { result } = await this.server.queryContract(contractId, method, args);
      const value = normalize(unwrap(result));
      let ledger: number | null = null;
      try {
        ledger = (await this.server.getLatestLedger()).sequence;
      } catch {
        /* ledger is optional evidence; value itself already read */
      }
      const evidence: Evidence = { contractId, rpcUrl: this.rpcUrl, fetchedAt, ledger };
      return { status: "ok", value, evidence };
    } catch (e) {
      return {
        status: "unknown",
        reason: `${name}.${method}: ${e instanceof Error ? e.message : String(e)}`,
        evidence: { contractId, rpcUrl: this.rpcUrl, fetchedAt },
      };
    }
  }

  /** identity.get_credential — `null` is an on-chain answer (no credential), not an error. */
  getCredential(subject: string): Promise<Read<CredentialView | null>> {
    return this.read("civic-identity", "get_credential", { subject }, (raw) => {
      if (raw === null || raw === undefined) return null;
      const o = raw as Record<string, unknown>;
      return {
        subject: str(o.subject),
        commitment: hexOf(o.commitment),
        credential_type: str(o.credential_type),
        status: Number(o.status),
        eligible: bool(o.eligible),
        issued_at: big(o.issued_at),
        updated_at: big(o.updated_at),
      } satisfies CredentialView;
    });
  }

  isEligible(subject: string): Promise<Read<boolean>> {
    return this.read("civic-identity", "is_eligible", { subject }, bool);
  }

  getProposal(id: bigint | number): Promise<Read<ProposalView | null>> {
    return this.read("civic-proposal", "get", { id: big(id) }, (raw) => {
      if (raw === null || raw === undefined) return null;
      const o = raw as Record<string, unknown>;
      return {
        id: big(o.id),
        proposer: str(o.proposer),
        title_hash: hexOf(o.title_hash),
        description_hash: hexOf(o.description_hash),
        metadata_hash: hexOf(o.metadata_hash),
        content_cid: str(o.content_cid),
        evidence_root: hexOf(o.evidence_root),
        created_at: big(o.created_at),
        opens_at: big(o.opens_at),
        closes_at: big(o.closes_at),
        cancelled: bool(o.cancelled),
        cancel_reason_hash: hexOr(o.cancel_reason_hash),
        evidence: arrOfStr(o.evidence),
      } satisfies ProposalView;
    });
  }

  /** Computed status (0 SCHEDULED, 1 OPEN, 2 CLOSED, 3 CANCELLED). */
  proposalStatus(id: bigint | number): Promise<Read<number>> {
    return this.read("civic-proposal", "status", { id: big(id) }, (raw) => {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 3) {
        throw new Error(`invalid status ${String(raw)}`);
      }
      return n;
    });
  }

  nextProposalId(): Promise<Read<bigint>> {
    return this.read("civic-proposal", "next_id", {}, big);
  }

  getTally(proposalId: bigint | number): Promise<Read<TallyView | null>> {
    return this.read("civic-vote", "get_tally", { proposal_id: big(proposalId) }, (raw) => {
      if (raw === null || raw === undefined) return null;
      const o = raw as Record<string, unknown>;
      return {
        proposal_id: big(o.proposal_id),
        total: big(o.total),
        counts: toCounts(o.counts),
        public_votes: big(o.public_votes),
        commitment_votes: big(o.commitment_votes),
        verification_mode: str(o.verification_mode),
      } satisfies TallyView;
    });
  }

  hasVotedPublic(proposalId: bigint | number, voter: string): Promise<Read<boolean>> {
    return this.read(
      "civic-vote",
      "has_voted_public",
      { proposal_id: big(proposalId), voter },
      bool,
    );
  }

  membershipRoot(proposalId: bigint | number): Promise<Read<string | null>> {
    return this.read(
      "civic-vote",
      "membership_root",
      { proposal_id: big(proposalId) },
      (raw) => (raw === null || raw === undefined ? null : hexOf(raw)),
    );
  }

  reportCount(): Promise<Read<bigint>> {
    return this.read("civic-accountability", "count", {}, big);
  }

  getReport(reportId: bigint | number): Promise<Read<ReportView | null>> {
    return this.read("civic-accountability", "get", { report_id: big(reportId) }, (raw) => {
      if (raw === null || raw === undefined) return null;
      const o = raw as Record<string, unknown>;
      return {
        id: big(o.id),
        proposal_id: big(o.proposal_id),
        report_hash: hexOf(o.report_hash),
        evidence_hash: hexOf(o.evidence_hash),
        kind: str(o.kind),
        author: str(o.author),
        anchored_at: big(o.anchored_at),
      } satisfies ReportView;
    });
  }

  /**
   * Read the tally and run deterministic verification.
   * Read failure => unknown envelope. No tally on-chain => verdict unknown.
   * Never reports a fabricated or optimistic verdict.
   */
  async verifyTally(
    proposalId: bigint | number,
    opts: VerifyOptions = {},
  ): Promise<Read<VerificationResult>> {
    const read = await this.getTally(proposalId);
    if (read.status === "unknown") return read;
    return {
      status: "ok",
      value: verifyTally(read.value, opts),
      evidence: read.evidence,
    };
  }
}
