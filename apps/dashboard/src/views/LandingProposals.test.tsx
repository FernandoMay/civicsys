/**
 * These tests exist to make the honesty rules executable.
 *
 * Each one pins a behaviour that the previous implementation violated, so a
 * regression to fabricated data fails the build rather than shipping.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import Landing from "./Landing.js";
import Proposals from "./Proposals.js";
import type { ProposalRow, PublicStats } from "../lib/chain.js";
import type { Evidence, Read } from "@brugulacivica/sdk";

const evidence: Evidence = {
  contractId: "CABC",
  rpcUrl: "https://example.invalid",
  fetchedAt: "2026-01-01T00:00:00.000Z",
  ledger: 1,
};

const ok = <T,>(value: T): Read<T> => ({ status: "ok", value, evidence });
const bad = <T,>(reason = "rpc caído"): Read<T> => ({ status: "unknown", reason, evidence });

function stats(over: Partial<PublicStats> = {}): PublicStats {
  return {
    proposals: ok(3n),
    anchoredReports: ok(7n),
    ...over,
  };
}

const NET = { network: "testnet" } as const;

describe("Landing", () => {
  it("shows chain-derived counts", () => {
    render(
      <Landing
        stats={stats()}
        network={NET.network}
        onExplore={() => {}}
        onCheckCredential={() => {}}
      />,
    );
    expect(screen.getByTestId("metric-Iniciativas")).toHaveTextContent("3");
    expect(screen.getByTestId("metric-Reportes")).toHaveTextContent("7");
  });

  it("renders UNKNOWN, never 0, when the chain could not be read", () => {
    render(
      <Landing
        stats={stats({ proposals: bad(), anchoredReports: bad() })}
        network={NET.network}
        onExplore={() => {}}
        onCheckCredential={() => {}}
      />,
    );
    const metric = screen.getByTestId("metric-Iniciativas");
    expect(metric).toHaveTextContent("DESCONOCIDO");
    expect(metric).not.toHaveTextContent("0");
  });

  it("never claims a secret or anonymous ballot", () => {
    const { container } = render(
      <Landing
        stats={stats()}
        network={NET.network}
        onExplore={() => {}}
        onCheckCredential={() => {}}
      />,
    );
    const text = (container.textContent ?? "").toLowerCase();
    // The old copy read "Voto secreto garantizado ... sin revelar tu identidad".
    expect(text).not.toContain("secreto garantizado");
    expect(text).not.toContain("voto secreto");
    expect(text).toContain("no es anónimo");
  });

  it("states plainly that ZK anonymity does not exist", () => {
    const { container } = render(
      <Landing
        stats={stats()}
        network={NET.network}
        onExplore={() => {}}
        onCheckCredential={() => {}}
      />,
    );
    expect(container.textContent ?? "").toContain("NO EXISTE");
  });

  it("navigates on both calls to action", async () => {
    const user = userEvent.setup();
    const onExplore = vi.fn();
    const onCheck = vi.fn();
    render(
      <Landing
        stats={stats()}
        network={NET.network}
        onExplore={onExplore}
        onCheckCredential={onCheck}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Explorar Iniciativas/i }));
    await user.click(screen.getByRole("button", { name: /Verificar una Credencial/i }));
    expect(onExplore).toHaveBeenCalledOnce();
    expect(onCheck).toHaveBeenCalledOnce();
  });
});

/** A syntactically valid G address: "G" + exactly 55 base32 characters. */
const ADDR = "G" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW".slice(0, 55);

/** A real proposal record, so the card renders the populated branch. */
function proposal(over: Record<string, unknown> = {}) {
  return {
    id: 1n,
    proposer: ADDR,
    title_hash: "a".repeat(64),
    description_hash: "b".repeat(64),
    metadata_hash: "c".repeat(64),
    content_cid: "bafybeigdyrzt",
    evidence_root: "d".repeat(64),
    created_at: 1_700_000_000n,
    opens_at: 1_700_000_000n,
    closes_at: 1_700_003_600n,
    cancelled: false,
    cancel_reason_hash: null,
    evidence: [],
    ...over,
  };
}

/** Defaults to a real proposal so `status` is the only thing under test. */
function row(over: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: 1n,
    proposal: ok(proposal()),
    status: ok(1),
    ...over,
  };
}

describe("Proposals — fail-closed status", () => {
  it("does NOT show a known label when the status read failed", () => {
    // Regression guard: the old code returned STATUS_BADGE[0] ("Programada")
    // for an unknown status, i.e. a fabricated default.
    render(
      <Proposals
        rows={[row({ status: bad() })]}
        nextId={ok(2n)}
        loading={false}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText(/DESCONOCIDO/)).toBeInTheDocument();
    expect(screen.queryByText(/PROGRAMADA/)).toBeNull();
  });

  it("renders the real on-chain id, not an invented CIV-2025 label", () => {
    render(
      <Proposals
        rows={[row({ id: 1n, proposal: ok(proposal()) })]}
        nextId={ok(2n)}
        loading={false}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText("ID #1")).toBeInTheDocument();
    expect(screen.queryByText(/CIV-2025/)).toBeNull();
  });

  it("renders DESCONOCIDO when the proposal record itself is unreadable", () => {
    render(
      <Proposals
        rows={[row({ proposal: bad("nodo caído") })]}
        nextId={ok(2n)}
        loading={false}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText(/SIN LECTURA/)).toBeInTheDocument();
    expect(screen.getByText(/nodo caído/)).toBeInTheDocument();
  });

  it("says the chain has no such proposal, rather than rendering nothing", () => {
    render(
      <Proposals
        rows={[row({ proposal: ok(null) })]}
        nextId={ok(2n)}
        loading={false}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText(/NO EXISTE/)).toBeInTheDocument();
  });

  it("disables voting when the proposal is not open", () => {
    render(
      <Proposals rows={[row({ status: ok(2) })]} nextId={ok(2n)} loading={false} onOpen={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /Inspeccionar en cadena/i })).toBeDisabled();
  });

  it("enables voting and forwards the real id when open", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <Proposals rows={[row({ status: ok(1) })]} nextId={ok(2n)} loading={false} onOpen={onOpen} />,
    );
    const btn = screen.getByRole("button", { name: /Votar en esta iniciativa/i });
    expect(btn).toBeEnabled();
    await user.click(btn);
    expect(onOpen).toHaveBeenCalledWith(1n);
  });

  it("says why it cannot show proposals when next_id is unreadable", () => {
    render(
      <Proposals rows={[]} nextId={bad("nodo sin respuesta")} loading={false} onOpen={() => {}} />,
    );
    expect(screen.getAllByText(/nodo sin respuesta/).length).toBeGreaterThan(0);
  });

  it("filters by open/closed using real statuses", async () => {
    const user = userEvent.setup();
    render(
      <Proposals
        rows={[
          row({ id: 1n, status: ok(1), proposal: ok(proposal({ id: 1n })) }),
          row({ id: 2n, status: ok(2), proposal: ok(proposal({ id: 2n })) }),
        ]}
        nextId={ok(3n)}
        loading={false}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText("ID #1")).toBeInTheDocument();
    expect(screen.getByText("ID #2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ABIERTAS" }));
    expect(screen.getByText("ID #1")).toBeInTheDocument();
    expect(screen.queryByText("ID #2")).toBeNull();

    await user.click(screen.getByRole("button", { name: "CERRADAS" }));
    expect(screen.getByText("ID #2")).toBeInTheDocument();
    expect(screen.queryByText("ID #1")).toBeNull();
  });
});