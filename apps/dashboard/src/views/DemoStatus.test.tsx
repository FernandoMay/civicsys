import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DemoStatus from "./DemoStatus.js";
import type { Read } from "@brugulacivica/sdk";

const evidence = {
  contractId: "CABC",
  rpcUrl: "https://example.invalid",
  fetchedAt: "2026-01-01T00:00:00.000Z",
  ledger: 1,
};

const ok = <T,>(value: T): Read<T> => ({ status: "ok", value, evidence });
const bad = <T,>(reason = "rpc caído"): Read<T> => ({ status: "unknown", reason, evidence });

function renderPanel(over: Partial<Parameters<typeof DemoStatus>[0]> = {}) {
  const props: Parameters<typeof DemoStatus>[0] = {
    proposalCount: ok(4n),
    reportCount: ok(7n),
    ledger: 5_147_229,
    verifiableProposals: 0,
    unverifiableProposals: 4,
    ...over,
  };
  return render(<DemoStatus {...props} />);
}

/**
 * The panel exists so a presenter never has to improvise an apology. Each test
 * pins one line to the exact state that produced it, because a panel that says
 * "verifiable" while the chain is misbehaving is worse than no panel.
 */
describe("DemoStatus", () => {
  it("reports the live ledger when the chain answered", () => {
    renderPanel();
    expect(screen.getByText(/Leer la cadena Stellar testnet/)).toBeInTheDocument();
    expect(screen.getByText(/5\.147\.229/)).toBeInTheDocument();
    expect(screen.getAllByText("[✓ VERIFICABLE]").length).toBeGreaterThan(0);
  });

  it("reports the chain as unavailable when the RPC did not answer", () => {
    renderPanel({ ledger: null });
    expect(screen.getByText(/El RPC público no respondió/)).toBeInTheDocument();
    // Never claim a number there is no number for.
    expect(screen.queryByText(/5\.147\.229/)).toBeNull();
  });

  it("counts records from the chain, not from a constant", () => {
    renderPanel();
    expect(screen.getByText(/4 iniciativas y 7 reportes anclados/)).toBeInTheDocument();
  });

  it("says the counters are unknown rather than zero when they could not be read", () => {
    renderPanel({ proposalCount: bad("nodo caído") });
    expect(screen.getByText(/No se pudo leer el total/)).toBeInTheDocument();
    expect(screen.queryByText(/4 iniciativas y 7 reportes/)).toBeNull();
  });

  it("blocks publishing on the missing PINATA_JWT and names it", () => {
    renderPanel();
    expect(screen.getByText(/Publicar una iniciativa nueva/)).toBeInTheDocument();
    expect(screen.getAllByText(/PINATA_JWT/).length).toBeGreaterThan(0);
    expect(screen.getByText(/responde 503/)).toBeInTheDocument();
  });

  // The exact state of the branch today: four records, zero readable.
  it("marks content unavailable when nothing is verifiable, and says which records", () => {
    renderPanel({ verifiableProposals: 0, unverifiableProposals: 4 });
    expect(screen.getByText(/Las 4 iniciativas registradas/)).toBeInTheDocument();
    expect(screen.getByText(/MISMATCH/)).toBeInTheDocument();
  });

  it("marks content verifiable as soon as one proposal checks out", () => {
    renderPanel({ verifiableProposals: 1, unverifiableProposals: 3 });
    expect(screen.getByText(/1 iniciativa\(s\) se recuperan/)).toBeInTheDocument();
    expect(screen.queryByText(/1 iniciativa\(s\) se recuperan/)).toBeInTheDocument();
  });

  it("never presents cryptographic anonymity as available", () => {
    renderPanel();
    expect(screen.getByText(/Anonimato criptográfico en el voto/)).toBeInTheDocument();
    expect(screen.getByText(/No hay verificador ZK desplegado/)).toBeInTheDocument();
    expect(screen.getAllByText("[✕ NO DISPONIBLE]").length).toBeGreaterThan(0);
  });
});
