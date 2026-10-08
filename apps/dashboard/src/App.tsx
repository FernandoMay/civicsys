import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CivicReader,
  CONTRACT_NAMES,
  PROPOSAL_STATUS_LABEL,
  explorerLinks,
  parseDeployment,
  rpcUrlFromEnv,
  type ContractName,
  type CredentialView,
  type ProposalView,
  type Read,
  type ReportView,
  type VerificationResult,
} from "@civicsys/sdk";
import deploymentRaw from "../../../deployments/testnet.json";

/**
 * CivicSys dashboard — fail-closed by construction (RFC CIVICSYS-ARCH-001 §0/§6).
 *
 * Every number rendered below comes from an `ok` read of the Stellar chain.
 * Anything unreadable renders as UNKNOWN with its reason. There is no code
 * path that invents a default, a zero, or an optimistic state.
 */

const record = parseDeployment(deploymentRaw);
const links = explorerLinks(record);
const reader = new CivicReader(record, rpcUrlFromEnv());

const MAX_PROPOSALS = 20;
const MAX_REPORTS = 20;

interface ProposalRow {
  id: bigint;
  proposal: Read<ProposalView | null>;
  status: Read<number>;
  verification: Read<VerificationResult>;
}

interface DashboardData {
  nextId: Read<bigint>;
  reportCount: Read<bigint>;
  reports: { id: bigint; report: Read<ReportView | null> }[];
  proposals: ProposalRow[];
  admins: { name: ContractName; read: Read<string> }[];
  credential: Read<CredentialView | null>;
  fetchedAt: string;
}

/* ---------------------------------- ui bits ---------------------------------- */

type ChipKind = "verified" | "mismatch" | "unknown" | "ok" | "open" | "closed";

function Chip({ kind, children }: { kind: ChipKind; children: React.ReactNode }) {
  return <span className={`chip chip-${kind}`}>{children}</span>;
}

function UnknownPanel({ reason }: { reason?: string }) {
  return (
    <div className="unknown" title={reason}>
      <span className="chip chip-unknown">UNKNOWN</span>
      {reason ? <span className="reason">{reason}</span> : <span className="reason">no on-chain evidence</span>}
    </div>
  );
}

function shortHash(h: string): string {
  return h.length > 16 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h;
}

function fmtTime(sec: bigint): string {
  return new Date(Number(sec) * 1000).toISOString().replace(".000Z", "Z");
}

function verdictChip(v: "verified" | "mismatch" | "unknown") {
  if (v === "verified") return <Chip kind="verified">VERIFIED</Chip>;
  if (v === "mismatch") return <Chip kind="mismatch">MISMATCH</Chip>;
  return <Chip kind="unknown">UNKNOWN</Chip>;
}

function modeLabel(mode: string): React.ReactNode {
  if (mode === "public_v1") return <Chip kind="ok">PUBLIC VOTE</Chip>;
  if (mode === "commitment_v1") return <Chip kind="unknown">COMMITMENT · NOT ZK</Chip>;
  return <Chip kind="mismatch">UNPROVEN MODE</Chip>;
}

/* ---------------------------------- sections -------------------------------- */

function EvidencePanel() {
  return (
    <section>
      <h2>Deployment evidence</h2>
      <p className="muted">
        Every contract below carries network, address, deploy tx, ledger, wasm sha256 and version —
        verified by <code>scripts/verify-deployment.sh</code>. Unverifiable records are rejected, not displayed.
      </p>
      <div className="grid">
        {CONTRACT_NAMES.map((name) => {
          const c = record.contracts[name];
          if (!c) return null;
          return (
            <div className="card" key={name}>
              <div className="card-head">
                <strong>{name}</strong>
                <Chip kind="ok">v{c.version}</Chip>
              </div>
              <dl>
                <dt>contract</dt>
                <dd>
                  <a href={links.contracts[name]!} target="_blank" rel="noreferrer">
                    <code>{c.contract_id.slice(0, 10)}…{c.contract_id.slice(-6)}</code>
                  </a>
                </dd>
                <dt>deploy tx</dt>
                <dd>
                  <a href={links.tx(c.deploy_tx)} target="_blank" rel="noreferrer">
                    <code>{shortHash(c.deploy_tx)}</code>
                  </a>
                </dd>
                <dt>ledger</dt>
                <dd>{c.deploy_ledger ?? <span className="warn">not recorded</span>}</dd>
                <dt>wasm sha256</dt>
                <dd>
                  <code title={c.wasm_sha256}>{shortHash(c.wasm_sha256)}</code>
                </dd>
              </dl>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TallyBlock({ v }: { v: Read<VerificationResult> }) {
  if (v.status === "unknown") return <UnknownPanel reason={v.reason} />;
  const { verdict, checks, tally, mode } = v.value;
  if (tally === null) {
    return (
      <div className="tally">
        <div className="tally-head">{verdictChip(verdict)}</div>
        <UnknownPanel reason="no tally recorded on-chain — no votes yet or none proven" />
      </div>
    );
  }
  const failed = checks.filter((c) => c.state === false);
  return (
    <div className="tally">
      <div className="tally-head">
        {verdictChip(verdict)} {mode !== null && modeLabel(mode)}
        <span className="muted">
          {" "}total {tally.total.toString()} · public {tally.public_votes.toString()} · commitment{" "}
          {tally.commitment_votes.toString()}
        </span>
      </div>
      <ul className="bars">
        {[...tally.counts.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([choice, n]) => {
            const pct = tally.total > 0n ? Number((n * 10000n) / tally.total) / 100 : 0;
            return (
              <li key={choice}>
                <span className="bar-label">Option {choice}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${pct}%` }} />
                </span>
                <span className="bar-num">
                  {n.toString()} ({pct.toFixed(1)}%)
                </span>
              </li>
            );
          })}
      </ul>
      <details>
        <summary>
          {checks.length} deterministic checks{" "}
          {failed.length > 0 ? <span className="bad">({failed.length} failing)</span> : "(all passing)"}
        </summary>
        <ul className="checks">
          {checks.map((c) => (
            <li key={c.id} className={c.state === false ? "fail" : c.state === "unknown" ? "unk" : "pass"}>
              <code>{c.id}</code> {c.detail}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function ProposalCard({ row }: { row: ProposalRow }) {
  const { proposal, status, verification } = row;
  return (
    <div className="card proposal">
      <div className="card-head">
        <strong>Proposal #{row.id.toString()}</strong>
        {status.status === "unknown" ? (
          <Chip kind="unknown">STATUS UNKNOWN</Chip>
        ) : (
          <Chip
            kind={
              status.value === 1
                ? "open"
                : status.value === 0
                  ? "unknown"
                  : status.value === 3
                    ? "mismatch"
                    : "closed"
            }
          >
            {PROPOSAL_STATUS_LABEL[status.value] ?? "?"}
          </Chip>
        )}
      </div>

      {proposal.status === "unknown" ? (
        <UnknownPanel reason={proposal.reason} />
      ) : proposal.value === null ? (
        <UnknownPanel reason="proposal id not found on-chain" />
      ) : (
        <dl>
          <dt>content CID (off-chain)</dt>
          <dd>
            <code className="wrap">{proposal.value.content_cid}</code>
          </dd>
          <dt>title hash</dt>
          <dd>
            <code>{shortHash(proposal.value.title_hash)}</code>
          </dd>
          <dt>window</dt>
          <dd>
            {fmtTime(proposal.value.opens_at)} → {fmtTime(proposal.value.closes_at)}
          </dd>
          <dt>proposer</dt>
          <dd>
            <a
              href={`https://stellar.expert/explorer/${record.network}/account/${proposal.value.proposer}`}
              target="_blank"
              rel="noreferrer"
            >
              <code>{proposal.value.proposer.slice(0, 10)}…</code>
            </a>
          </dd>
        </dl>
      )}

      <h3>
        Tally <span className="muted">(verified against on-chain state)</span>
      </h3>
      <TallyBlock v={verification} />
    </div>
  );
}

/* ----------------------------------- app ------------------------------------ */

export default function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextId = await reader.nextProposalId();
      const reportCount = await reader.reportCount();
      const admins = await Promise.all(
        CONTRACT_NAMES.map(async (name) => ({ name, read: await reader.admin(name) })),
      );
      const credential = await reader.getCredential(record.source_account);

      const proposals: ProposalRow[] = [];
      if (nextId.status === "ok") {
        const n = Number(nextId.value);
        for (let id = 1; id < n && id <= MAX_PROPOSALS; id++) {
          const [proposal, status, verification] = await Promise.all([
            reader.getProposal(BigInt(id)),
            reader.proposalStatus(BigInt(id)),
            reader.verifyTally(BigInt(id)),
          ]);
          proposals.push({ id: BigInt(id), proposal, status, verification });
        }
      }

      const reports: DashboardData["reports"] = [];
      if (reportCount.status === "ok") {
        const n = Number(reportCount.value);
        for (let id = 1; id <= n && id <= MAX_REPORTS; id++) {
          reports.push({ id: BigInt(id), report: await reader.getReport(BigInt(id)) });
        }
      }

      if (!mounted.current) return;
      setData({ nextId, reportCount, reports, proposals, admins, credential, fetchedAt: new Date().toISOString() });
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const iv = setInterval(() => void load(), 30_000);
    return () => {
      mounted.current = false;
      clearInterval(iv);
    };
  }, [load]);

  const ledger = useMemo(() => {
    const ok = data?.admins.find((a) => a.read.status === "ok");
    return ok && ok.read.status === "ok" ? ok.read.evidence.ledger : null;
  }, [data]);

  const identityOk = data?.admins.filter((a) => a.read.status === "ok").length ?? 0;

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>CivicSys</h1>
          <p className="tagline">Civic decisions. Verifiable by design.</p>
        </div>
        <div className="header-right">
          <span className="chip chip-ok">{record.network}</span>
          <span className="muted">
            {ledger !== null ? `ledger ${ledger}` : "ledger UNKNOWN"} ·{" "}
            {identityOk}/{CONTRACT_NAMES.length} contracts answering
          </span>
          <button onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <p className="disclaimer">
        This page never invents state: any value that cannot be read from the Stellar chain is shown
        as <strong>UNKNOWN</strong>. Verification modes: <strong>public_v1</strong> (transparent) and{" "}
        <strong>commitment_v1</strong> (privacy-preserving commitment, <em>not</em> zero-knowledge —
        ZK arrives only with a deployed verifier, RFC §Phase 4).
      </p>

      {error && (
        <div className="banner-error">
          read failed: {error} — affected values render as UNKNOWN
        </div>
      )}

      <EvidencePanel />

      <section>
        <h2>
          Proposals{" "}
          <span className="muted">
            {data?.nextId.status === "ok"
              ? `next id ${data.nextId.value.toString()}`
              : "count UNKNOWN"}
          </span>
        </h2>
        {data === null && loading ? (
          <UnknownPanel reason="loading chain state…" />
        ) : data?.nextId.status === "unknown" ? (
          <UnknownPanel reason={data.nextId.reason} />
        ) : data && data.proposals.length === 0 ? (
          <UnknownPanel reason="no proposals on-chain yet (next_id = 1)" />
        ) : (
          data?.proposals.map((row) => <ProposalCard key={row.id.toString()} row={row} />)
        )}
      </section>

      <section>
        <h2>Accountability reports</h2>
        {data?.reportCount.status === "unknown" ? (
          <UnknownPanel reason={data.reportCount.reason} />
        ) : data && data.reports.length === 0 ? (
          <UnknownPanel reason="no reports anchored on-chain yet" />
        ) : (
          <div className="grid">
            {data?.reports.map(({ id, report }) => (
              <div className="card" key={id.toString()}>
                <div className="card-head">
                  <strong>Report #{id.toString()}</strong>
                  {report.status === "ok" && report.value ? (
                    <Chip kind="ok">{report.value.kind}</Chip>
                  ) : null}
                </div>
                {report.status === "unknown" ? (
                  <UnknownPanel reason={report.reason} />
                ) : report.value === null ? (
                  <UnknownPanel reason="report id not found on-chain" />
                ) : (
                  <dl>
                    <dt>proposal</dt>
                    <dd>#{report.value.proposal_id.toString()}</dd>
                    <dt>report hash</dt>
                    <dd>
                      <code>{shortHash(report.value.report_hash)}</code>
                    </dd>
                    <dt>evidence hash</dt>
                    <dd>
                      <code>{shortHash(report.value.evidence_hash)}</code>
                    </dd>
                    <dt>anchored</dt>
                    <dd>{fmtTime(report.value.anchored_at)}</dd>
                  </dl>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2>Identity</h2>
        <div className="grid">
          <div className="card">
            <div className="card-head">
              <strong>Deployer credential</strong>
              {data?.credential.status === "ok" && data.credential.value ? (
                <Chip kind={data.credential.value.status === 0 && data.credential.value.eligible ? "ok" : "mismatch"}>
                  {data.credential.value.status === 0
                    ? data.credential.value.eligible
                      ? "ACTIVE · ELIGIBLE"
                      : "ACTIVE · INELIGIBLE"
                    : data.credential.value.status === 1
                      ? "SUSPENDED"
                      : "REVOKED"}
                </Chip>
              ) : null}
            </div>
            {data?.credential.status === "unknown" ? (
              <UnknownPanel reason={data.credential.reason} />
            ) : data?.credential.value === null ? (
              <UnknownPanel reason="no credential issued to this account on-chain" />
            ) : data?.credential.value ? (
              <dl>
                <dt>subject</dt>
                <dd>
                  <code>{data.credential.value.subject.slice(0, 12)}…</code>
                </dd>
                <dt>commitment</dt>
                <dd>
                  <code>{shortHash(data.credential.value.commitment)}</code>
                </dd>
                <dt>type</dt>
                <dd>{data.credential.value.credential_type}</dd>
              </dl>
            ) : null}
          </div>
          <div className="card">
            <div className="card-head">
              <strong>RPC liveness</strong>
              <Chip kind="ok">{record.network_passphrase.split(";")[0]!.trim()}</Chip>
            </div>
            <dl>
              <dt>rpc</dt>
              <dd>
                <code className="wrap">{reader.rpcUrl}</code>
              </dd>
              <dt>fetched at</dt>
              <dd>{data?.fetchedAt ?? <span className="warn">not fetched yet</span>}</dd>
            </dl>
          </div>
        </div>
      </section>

      <footer>
        <p className="muted">
          Source of truth: <code>docs/rfc/CIVICSYS-ARCH-001.md</code> · evidence:{" "}
          <code>deployments/testnet.json</code>, <code>deployments/smoke-test.json</code> ·
          generated {record.generated_at}
        </p>
      </footer>
    </div>
  );
}
