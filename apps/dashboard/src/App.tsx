import { useEffect, useState } from "react";

import Landing from "./views/Landing.js";
import Proposals from "./views/Proposals.js";
import HermesEvidence from "./views/HermesEvidence.js";
import Vote from "./views/Vote.js";
import Guarantees from "./views/Guarantees.js";
import CredentialModal from "./views/CredentialModal.js";
import { fetchProposalRows, type ProposalRow } from "./lib/chain.js";

type View = "landing" | "dashboard";

export default function App() {
  const [view, setView] = useState<View>("landing");
  const [credentialOpen, setCredentialOpen] = useState(false);
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const [nextId, setNextId] = useState<{ status: "ok" | "unknown"; value?: bigint; reason?: string }>({ status: "unknown", reason: "no leído" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const modal = document.getElementById("credential-modal");
    if (!modal) return;
    const hide = () => setCredentialOpen(false);
    modal.addEventListener("transitionend", hide, { once: true });
    return () => modal.removeEventListener("transitionend", hide);
  }, []);

  const loadProposals = async () => {
    setLoading(true);
    try {
      const result = await fetchProposalRows(20);
      setRows(result.rows);
      setNextId(result.nextId.status === "ok" ? { status: "ok", value: result.nextId.value } : { status: "unknown", reason: result.nextId.reason });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (view === "dashboard") {
      loadProposals();
    }
  }, [view]);

  if (view === "landing") {
    return <Landing />;
  }

  return (
    <div className="civicsys-app">
      <Proposals rows={rows} nextId={nextId} loading={loading} />
      <HermesEvidence />
      <Vote />
      <Guarantees />
      {credentialOpen && <CredentialModal />}
    </div>
  );
}
