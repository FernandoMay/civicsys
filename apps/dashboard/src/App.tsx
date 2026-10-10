/**
 * App shell.
 *
 * The previous shell could never leave the landing view: `setView` was declared
 * but never called, so the entire dashboard was unreachable behind a dead
 * `href="#proposals"` link. Navigation is now real state, and the credential
 * modal is opened by React state rather than by poking `classList` on an
 * element that was not rendered.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import Landing from "./views/Landing.js";
import Proposals from "./views/Proposals.js";
import Accountability, { type ReportEntry } from "./views/Accountability.js";
import Vote from "./views/Vote.js";
import Guarantees from "./views/Guarantees.js";
import CredentialModal from "./views/CredentialModal.js";
import {
  deployment,
  fetchProposalRows,
  fetchPublicStats,
  fetchReports,
  type ProposalRow,
  type PublicStats,
} from "./lib/chain.js";
import type { Read } from "@brugulacivica/sdk";

type View = "landing" | "dashboard";

export default function App() {
  const [view, setView] = useState<View>("landing");
  const [credentialOpen, setCredentialOpen] = useState(false);
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const [nextId, setNextId] = useState<Read<bigint>>({
    status: "unknown",
    reason: "sin lectura",
    evidence: { contractId: "", rpcUrl: "", fetchedAt: new Date().toISOString() },
  });
  const [reports, setReports] = useState<{ count: Read<bigint>; reports: ReportEntry[] }>({
    count: { status: "unknown", reason: "sin lectura", evidence: nextId.evidence },
    reports: [],
  });
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<bigint | null>(null);

  const loadStats = useCallback(async () => {
    setStats(await fetchPublicStats());
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [proposalRead, reportRead, statsRead] = await Promise.all([
        fetchProposalRows(),
        fetchReports(),
        fetchPublicStats(),
      ]);
      setNextId(proposalRead.nextId);
      setRows(proposalRead.rows);
      setReports({ count: reportRead.count, reports: reportRead.reports });
      setStats(statsRead);
    } finally {
      setLoading(false);
    }
  }, []);

  // The landing page shows counts, so they must be read on mount — not only
  // after the user navigates into the dashboard. Otherwise the first screen
  // claims DESCONOCIDO for data that is perfectly readable.
  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (view === "dashboard") void load();
  }, [view, load]);

  const explorerBase = useMemo(
    () => `https://stellar.expert/explorer/${deployment.network}`,
    [],
  );

  const goVote = useCallback((id: bigint) => {
    setSelected(id);
    document.getElementById("votar")?.scrollIntoView({ behavior: "smooth" });
  }, []);

  if (view === "landing") {
    return (
      <>
        <Landing
          stats={stats}
          network={deployment.network}
          onExplore={() => setView("dashboard")}
          onCheckCredential={() => setCredentialOpen(true)}
        />
        {credentialOpen && <CredentialModal onClose={() => setCredentialOpen(false)} />}
      </>
    );
  }

  return (
    <div className="brujula-app">
      <header className="app-bar">
        <button type="button" className="btn btn-secondary" onClick={() => setView("landing")}>
          ← Inicio
        </button>
        <span className="app-bar-title">Brújula Cívica · {deployment.network}</span>
        <button type="button" className="btn btn-secondary" onClick={() => setCredentialOpen(true)}>
          Verificar credencial
        </button>
      </header>

      <Proposals rows={rows} nextId={nextId} loading={loading} onVote={goVote} />
      <Vote rows={rows} selected={selected} onSelect={setSelected} />
      <Accountability
        count={reports.count}
        reports={reports.reports}
        loading={loading}
        explorerBase={explorerBase}
        contractId={deployment.contracts["brujula-accountability"]!.contract_id}
      />
      <Guarantees />

      {credentialOpen && <CredentialModal onClose={() => setCredentialOpen(false)} />}
    </div>
  );
}