/**
 * App — routes, data loading, and composition.
 *
 * Routes are plain state: home (hero + initiatives + vote + reports +
 * guarantees), or one proposal's detail. The tally for the detail view and the
 * vote terminal share the same selected id, so opening a proposal and voting on
 * it never disagree about which initiative is on screen.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import Landing from "./views/Landing.js";
import Proposals from "./views/Proposals.js";
import ProposalDetail from "./views/ProposalDetail.js";
import Accountability from "./views/Accountability.js";
import Vote from "./views/Vote.js";
import Guarantees from "./views/Guarantees.js";
import CredentialModal from "./views/CredentialModal.js";
import Shell, { type Route } from "./views/Shell.js";
import {
  deployment,
  fetchLatestLedger,
  fetchProposalRows,
  fetchPublicStats,
  fetchReports,
  fetchTally,
  type ProposalRow,
  type PublicStats,
  type ReportEntry,
} from "./lib/chain.js";
import type { Read, VerificationResult } from "@brugulacivica/sdk";

const unknownRead = (reason: string): Read<bigint> => ({
  status: "unknown",
  reason,
  evidence: { contractId: "", rpcUrl: "", fetchedAt: new Date().toISOString() },
});

export default function App() {
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [credentialOpen, setCredentialOpen] = useState(false);
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [ledger, setLedger] = useState<number | null>(null);
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const [nextId, setNextId] = useState<Read<bigint>>(unknownRead("sin lectura"));
  const [reportState, setReportState] = useState<{ count: Read<bigint>; reports: ReportEntry[] }>({
    count: unknownRead("sin lectura"),
    reports: [],
  });
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<bigint | null>(null);
  const [detailTally, setDetailTally] = useState<Read<VerificationResult> | null>(null);

  const loadStats = useCallback(async () => {
    const [s, l] = await Promise.all([fetchPublicStats(), fetchLatestLedger()]);
    setStats(s);
    setLedger(l);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [proposalRead, reportRead, statsRead, liveLedger] = await Promise.all([
        fetchProposalRows(),
        fetchReports(),
        fetchPublicStats(),
        fetchLatestLedger(),
      ]);
      setNextId(proposalRead.nextId);
      setRows(proposalRead.rows);
      setReportState({ count: reportRead.count, reports: reportRead.reports });
      setStats(statsRead);
      setLedger(liveLedger);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
    void load();
  }, [loadStats, load]);

  const openDetail = useCallback(
    (id: bigint) => {
      setSelected(id);
      setRoute({ name: "detail", id });
      window.scrollTo({ top: 0 });
    },
    [],
  );

  const goHome = useCallback(() => {
    setRoute({ name: "home" });
    window.scrollTo({ top: 0 });
  }, []);

  const goVote = useCallback(
    (id: bigint) => {
      setSelected(id);
      setRoute({ name: "home" });
      requestAnimationFrame(() => {
        document.getElementById("votar")?.scrollIntoView({ behavior: "smooth" });
      });
    },
    [],
  );

  // Tally for the detail view follows the selected proposal.
  useEffect(() => {
    if (route.name !== "detail") {
      setDetailTally(null);
      return;
    }
    let cancelled = false;
    void fetchTally(route.id).then((t) => {
      if (!cancelled) setDetailTally(t);
    });
    return () => {
      cancelled = true;
    };
  }, [route]);

  const detailRow = useMemo(
    () => (route.name === "detail" ? (rows.find((r) => r.id === route.id) ?? null) : null),
    [route, rows],
  );

  const detailReports = useMemo(() => {
    if (route.name !== "detail") return [];
    return reportState.reports.filter(
      ({ report }) =>
        report.status === "ok" && report.value !== null && report.value.proposal_id === route.id,
    );
  }, [route, reportState.reports]);

  return (
    <Shell
      route={route}
      ledger={ledger}
      onNavigate={(r) => (r.name === "home" ? goHome() : openDetail(r.id))}
      onCheckCredential={() => setCredentialOpen(true)}
    >
      {route.name === "detail" ? (
        detailRow ? (
          <ProposalDetail
            row={detailRow}
            reports={detailReports}
            tally={detailTally}
            onBack={goHome}
            onVote={goVote}
          />
        ) : (
          <div className="py-space-xl">
            <p className="font-code-sm text-code-sm text-outline">
              [PROPUESTA NO ENCONTRADA — {loading ? "cargando…" : "no hay lectura para este id"}]
            </p>
            <button
              type="button"
              onClick={goHome}
              className="mt-space-sm px-space-md py-space-sm bg-surface-container-highest text-on-surface font-body-sm font-semibold"
            >
              ← Volver a iniciativas
            </button>
          </div>
        )
      ) : (
        <>
          <Landing
            stats={stats}
            network={deployment.network}
            onExplore={() => document.getElementById("proposals")?.scrollIntoView({ behavior: "smooth" })}
            onCheckCredential={() => setCredentialOpen(true)}
          />
          <Proposals rows={rows} nextId={nextId} loading={loading} onOpen={openDetail} />
          <Vote rows={rows} selected={selected} onSelect={setSelected} />
          <Accountability
            count={reportState.count}
            reports={reportState.reports}
            loading={loading}
            explorerBase={`https://stellar.expert/explorer/${deployment.network}`}
            contractId={deployment.contracts["brujula-accountability"]!.contract_id}
          />
          <Guarantees />
        </>
      )}

      {credentialOpen && <CredentialModal onClose={() => setCredentialOpen(false)} />}
    </Shell>
  );
}
