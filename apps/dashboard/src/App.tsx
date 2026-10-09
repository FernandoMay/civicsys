import { useEffect, useState } from "react";

import Landing from "./views/Landing.js";
import Proposals from "./views/Proposals.js";
import HermesEvidence from "./views/HermesEvidence.js";
import Vote from "./views/Vote.js";
import Guarantees from "./views/Guarantees.js";
import CredentialModal from "./views/CredentialModal.js";

type View = "landing" | "dashboard";

export default function App() {
  const [view, setView] = useState<View>("landing");
  const [credentialOpen, setCredentialOpen] = useState(false);

  useEffect(() => {
    const modal = document.getElementById("credential-modal");
    if (!modal) return;
    const hide = () => setCredentialOpen(false);
    modal.addEventListener("transitionend", hide, { once: true });
    return () => modal.removeEventListener("transitionend", hide);
  }, []);

  if (view === "landing") {
    return <Landing />;
  }

  return (
    <div className="civicsys-app">
      <Proposals proposals={[]} />
      <HermesEvidence />
      <Vote />
      <Guarantees />
      {credentialOpen && <CredentialModal />}
    </div>
  );
}
