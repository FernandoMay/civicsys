import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/**
 * The publish line is read from the function, not asserted in the panel.
 *
 * It used to hardcode "set PINATA_JWT", and it kept saying that after the secret
 * was in place, when the real blocker was the key's scope. These tests pin the
 * three states the probe can report, because each one sends the operator to a
 * different fix.
 */
function stubProbe(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body } as Response));
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    stubProbe({ ready: false, configured: false, reason: "Falta PINATA_JWT en el entorno de funciones." }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("names the missing secret when the function reports it is not configured", async () => {
    renderPanel();
    expect(screen.getByText(/Publicar una iniciativa nueva/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Falta PINATA_JWT/)).toBeInTheDocument());
    expect(screen.queryByText(/VERIFICABLE.*Publicar/s)).toBeNull();
  });

  // The case that actually happened: the secret was set, so telling the
  // operator to set it sent them to fix something already fine.
  it("names the missing scope when the secret exists but the key cannot pin", async () => {
    vi.stubGlobal(
      "fetch",
      stubProbe({
        ready: false,
        configured: true,
        reason: "PINATA_JWT está configurada, pero la clave no tiene el permiso pinFileToIPFS.",
      }),
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText(/pinFileToIPFS/)).toBeInTheDocument());
    expect(screen.getByText(/está configurada/)).toBeInTheDocument();
  });

  it("marks publishing verifiable only when the function says it is ready", async () => {
    vi.stubGlobal(
      "fetch",
      stubProbe({ ready: true, configured: true, reason: "Publicación disponible." }),
    );
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText(/El servicio de publicación responde/)).toBeInTheDocument(),
    );
  });

  // An unreadable probe must not be reported as "not configured": that would
  // send the operator to fix a secret that may well be fine.
  it("claims nothing about the secret when the probe itself cannot be read", async () => {
    vi.stubGlobal("fetch", stubProbe({}, false));
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText(/No se pudo consultar el estado del servicio/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Falta PINATA_JWT/)).toBeNull();
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
