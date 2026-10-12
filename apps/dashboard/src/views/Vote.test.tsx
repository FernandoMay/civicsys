/**
 * The ballot terminal is the most dangerous surface in the dashboard: it
 * spends the user's funds and writes to an immutable ledger.
 *
 * Every test below pins a precondition that must hold BEFORE a signature is
 * requested. The old implementation called `cast_public` without `choice`, with
 * a `"G..."` placeholder voter, and against a hardcoded proposal id, so none of
 * these guards existed. They are the difference between "a button" and a flow.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Vote from "./Vote.js";
import { WalletProvider, type WalletAdapter } from "../lib/wallet.js";
import type { ProposalRow } from "../lib/chain.js";
import type { Read, VerificationResult } from "@brugulacivica/sdk";

// Hoisted so the vi.mock factories can close over them without capturing
// top-level bindings (vitest evaluates the factories before the module body).
const mocks = vi.hoisted(() => ({
  reader: {
    proposalStatus: vi.fn(),
    isEligible: vi.fn(),
    hasVotedPublic: vi.fn(),
    membershipRoot: vi.fn(),
  },
  fetchTally: vi.fn(),
  voteClient: vi.fn(),
}));

// Partial mock: the real module is loaded so link builders and the deployment
// record work, while the reads that would hit the network are replaced.
vi.mock("../lib/chain.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/chain.js")>()),
  reader: mocks.reader,
  fetchTally: mocks.fetchTally,
}));
vi.mock("../lib/contracts.js", () => ({ voteClient: mocks.voteClient, proposalClient: vi.fn() }));

/** A syntactically valid G address: "G" + exactly 55 base32 characters. */
const ADDR = "G" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW".slice(0, 55);

const evidence = {
  contractId: "CABC",
  rpcUrl: "https://example.invalid",
  fetchedAt: "2026-01-01T00:00:00.000Z",
  ledger: 1,
};

const ok = <T,>(value: T): Read<T> => ({ status: "ok", value, evidence });
const bad = <T,>(reason = "rpc caído"): Read<T> => ({ status: "unknown", reason, evidence });

function proposal() {
  return {
    id: 1n,
    proposer: ADDR,
    title_hash: "a".repeat(64),
    description_hash: "b".repeat(64),
    metadata_hash: "c".repeat(64),
    content_cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    evidence_root: "d".repeat(64),
    created_at: 1_700_000_000n,
    opens_at: 1_700_000_000n,
    closes_at: 1_700_003_600n,
    cancelled: false,
    cancel_reason_hash: null,
    evidence: [],
  };
}

const openRow: ProposalRow = { id: 1n, proposal: ok(proposal()), status: ok(1) };

/** A connected, funded wallet: the only state where a ballot may be sent. */
const connectedAdapter: WalletAdapter = {
  name: "fake",
  isAvailable: async () => true,
  connect: async () => ADDR,
  restore: async () => ADDR,
  disconnect: async () => {},
  signTransaction: (async () => ({ signedTxXdr: "" })) as never,
};

/** No extension installed: nothing may be signed or sent from here. */
const absentAdapter: WalletAdapter = {
  name: "fake-absent",
  isAvailable: async () => false,
  connect: async () => {
    throw new Error("sin cartera en pruebas");
  },
  restore: async () => null,
  disconnect: async () => {},
  signTransaction: (async () => {
    throw new Error("sin cartera en pruebas");
  }) as never,
};

function renderVote(
  rows: ProposalRow[] = [openRow],
  selected: bigint | null = 1n,
  adapter: WalletAdapter = connectedAdapter,
) {
  return render(
    <WalletProvider adapter={adapter}>
      <Vote rows={rows} selected={selected} onSelect={() => {}} />
    </WalletProvider>,
  );
}

/** The ballot option, which is a radio input inside a label. */
function choose(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
  return user.click(screen.getByRole("radio", { name: label }));
}

function tally(total = 0n): Read<VerificationResult> {
  return {
    status: "ok",
    value: {
      verdict: "verified",
      mode: "public_v1",
      tally: {
        proposal_id: 1n,
        verification_mode: "public_v1",
        total,
        public_votes: 0n,
        commitment_votes: 0n,
        counts: new Map(),
      },
      checks: [],
    },
    evidence,
  };
}

/**
 * Every chain read the component performs before it may ask for a signature.
 * Overriding one simulates that specific read failing.
 */
function chainReads(over: {
  status?: Read<number>;
  eligible?: Read<boolean>;
  voted?: Read<boolean>;
  root?: Read<string | null>;
} = {}) {
  mocks.reader.proposalStatus.mockResolvedValue(over.status ?? ok(1));
  mocks.reader.isEligible.mockResolvedValue(over.eligible ?? ok(true));
  mocks.reader.hasVotedPublic.mockResolvedValue(over.voted ?? ok(false));
  mocks.reader.membershipRoot.mockResolvedValue(over.root ?? ok(null));
}

const SEND = /Confirmar y emitir voto/i;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchTally.mockResolvedValue(tally());
  mocks.voteClient.mockResolvedValue({
    cast_public: vi.fn().mockResolvedValue({ signAndSend: vi.fn() }),
  });
  chainReads();
});

describe("Vote — no wallet, no ballot", () => {
  it("offers to connect and never builds a client", () => {
    renderVote([openRow], 1n, absentAdapter);
    // The choice radios are disabled until a wallet is connected, so the
    // terminal cannot even be driven without one.
    expect(screen.getByRole("radio", { name: /A favor/i })).toBeDisabled();
    expect(mocks.voteClient).not.toHaveBeenCalled();
  });
});

describe("Vote — preconditions are revalidated against the chain", () => {
  it("refuses to send when the proposal is no longer open", async () => {
    const user = userEvent.setup();
    chainReads({ status: ok(2) });
    renderVote();
    await choose(user, /A favor/i);
    await user.click(screen.getByRole("button", { name: SEND }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/ya no está abierta/i));
    expect(mocks.voteClient).not.toHaveBeenCalled();
  });

  it("refuses to send when the status cannot be read", async () => {
    const user = userEvent.setup();
    chainReads({ status: bad("nodo caído") });
    renderVote();
    await choose(user, /A favor/i);
    await user.click(screen.getByRole("button", { name: SEND }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/no se envió el voto/i));
    expect(mocks.voteClient).not.toHaveBeenCalled();
  });

  it("refuses to send when the credential is not eligible", async () => {
    const user = userEvent.setup();
    chainReads({ eligible: ok(false) });
    renderVote();
    await choose(user, /A favor/i);
    await user.click(screen.getByRole("button", { name: SEND }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/no es elegible|no está activa/i),
    );
    expect(mocks.voteClient).not.toHaveBeenCalled();
  });

  it("refuses to send when eligibility cannot be read", async () => {
    const user = userEvent.setup();
    chainReads({ eligible: bad("timeout") });
    renderVote();
    await choose(user, /A favor/i);
    await user.click(screen.getByRole("button", { name: SEND }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/no se envió el voto/i));
    expect(mocks.voteClient).not.toHaveBeenCalled();
  });

  it("refuses a second ballot from the same wallet", async () => {
    const user = userEvent.setup();
    chainReads({ voted: ok(true) });
    renderVote();
    await choose(user, /A favor/i);
    await user.click(screen.getByRole("button", { name: SEND }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/ya emitió un voto público/i),
    );
    expect(mocks.voteClient).not.toHaveBeenCalled();
  });

  it("refuses when the already-voted read itself fails", async () => {
    const user = userEvent.setup();
    chainReads({ voted: bad("timeout") });
    renderVote();
    await choose(user, /A favor/i);
    await user.click(screen.getByRole("button", { name: SEND }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/no se envió/i));
    expect(mocks.voteClient).not.toHaveBeenCalled();
  });
});

describe("Vote — a public ballot that succeeds", () => {
  it("submits the real choice, voter and proposal, then shows a receipt", async () => {
    const user = userEvent.setup();
    const cast_public = vi.fn().mockResolvedValue({
      signAndSend: vi.fn().mockResolvedValue({
        sendTransactionResponse: { hash: "abc123" },
        getTransactionResponse: { latestLedger: 123456 },
      }),
    });
    mocks.voteClient.mockResolvedValue({ cast_public });
    renderVote();

    await choose(user, /En contra/i);
    await user.click(screen.getByRole("button", { name: SEND }));

    await waitFor(() => expect(cast_public).toHaveBeenCalledOnce());
    // The three arguments the contract actually needs, none of them invented.
    expect(cast_public).toHaveBeenCalledWith({ proposal_id: 1n, voter: ADDR, choice: 1 });

    await waitFor(() => expect(screen.getByText(/¡VOTO EMITIDO!/)).toBeInTheDocument());
    expect(screen.getByText(/TX: abc123/)).toBeInTheDocument();
    expect(screen.getByText(/ledger: 123456/)).toBeInTheDocument();
  });

  // The receipt is only worth what its holder can check, so the transaction and
  // the tally contract must both be one click away from it.
  it("links the receipt to the transaction and the tally contract in the explorer", async () => {
    const user = userEvent.setup();
    const cast_public = vi.fn().mockResolvedValue({
      signAndSend: vi.fn().mockResolvedValue({
        sendTransactionResponse: { hash: "abc123" },
        getTransactionResponse: { latestLedger: 123456 },
      }),
    });
    mocks.voteClient.mockResolvedValue({ cast_public });
    renderVote();

    await choose(user, /A favor/i);
    await user.click(screen.getByRole("button", { name: SEND }));
    await waitFor(() => expect(screen.getByText(/¡VOTO EMITIDO!/)).toBeInTheDocument());

    expect(screen.getByRole("link", { name: /Ver transacción en el explorador/i })).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet/tx/abc123",
    );
    expect(screen.getByRole("link", { name: /Ver contrato de escrutinio/i })).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet/contract/CCAC5O34PRORFLCXP5VBVJBGHDT25D3VASMN4SEY752RHKUKSU2JWNTP",
    );
  });

  it("shows no transaction link when the RPC returned no hash", async () => {
    const user = userEvent.setup();
    const cast_public = vi.fn().mockResolvedValue({
      signAndSend: vi.fn().mockResolvedValue({ sendTransactionResponse: {} }),
    });
    mocks.voteClient.mockResolvedValue({ cast_public });
    renderVote();

    await choose(user, /A favor/i);
    await user.click(screen.getByRole("button", { name: SEND }));

    await waitFor(() => expect(screen.getByText(/¡VOTO EMITIDO!/)).toBeInTheDocument());
    // Offering a link without a hash would point the reader at nothing.
    expect(screen.queryByRole("link", { name: /Ver transacción en el explorador/i })).toBeNull();
    expect(screen.getByRole("link", { name: /Ver contrato de escrutinio/i })).toBeInTheDocument();
  });

  it("reports the hash as UNKNOWN when the RPC omits it", async () => {
    const user = userEvent.setup();
    const cast_public = vi.fn().mockResolvedValue({
      signAndSend: vi.fn().mockResolvedValue({ sendTransactionResponse: {} }),
    });
    mocks.voteClient.mockResolvedValue({ cast_public });
    renderVote();

    await choose(user, /A favor/i);
    await user.click(screen.getByRole("button", { name: SEND }));

    await waitFor(() => expect(screen.getByText(/¡VOTO EMITIDO!/)).toBeInTheDocument());
    expect(screen.getByText(/TX: DESCONOCIDO/)).toBeInTheDocument();
    expect(screen.getByText(/ledger: DESCONOCIDO/)).toBeInTheDocument();
  });

  it("re-reads the tally after a successful ballot", async () => {
    const user = userEvent.setup();
    const cast_public = vi.fn().mockResolvedValue({
      signAndSend: vi.fn().mockResolvedValue({ sendTransactionResponse: { hash: "abc" } }),
    });
    mocks.voteClient.mockResolvedValue({ cast_public });
    renderVote();
    mocks.fetchTally.mockClear();

    await choose(user, /A favor/i);
    await user.click(screen.getByRole("button", { name: SEND }));

    await waitFor(() => expect(mocks.fetchTally).toHaveBeenCalledWith(1n));
  });

  it("shows the error instead of resetting the form when submission fails", async () => {
    const user = userEvent.setup();
    const cast_public = vi.fn().mockRejectedValue(new Error("la cartera rechazó la firma"));
    mocks.voteClient.mockResolvedValue({ cast_public });
    renderVote();

    await choose(user, /A favor/i);
    await user.click(screen.getByRole("button", { name: SEND }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/la cartera rechazó la firma/i),
    );
    expect(screen.queryByText(/¡VOTO EMITIDO!/)).toBeNull();
  });
});

describe("Vote — commitment mode stays honest", () => {
  it("blocks the mode when no membership root is published", async () => {
    chainReads({ root: ok(null) });
    renderVote();
    // The option is disabled, so the contract cannot be reached with a ballot
    // it would reject with RootNotSet.
    expect(screen.getByRole("radio", { name: /Por compromiso/i })).toBeDisabled();
    expect(mocks.voteClient).not.toHaveBeenCalled();
  });

  it("says the root could not be read rather than assuming there is none", async () => {
    chainReads({ root: bad("rpc caído") });
    renderVote();
    await waitFor(() =>
      expect(screen.getByText(/No se pudo leer la raíz de membresía/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("radio", { name: /Por compromiso/i })).toBeDisabled();
  });
});

describe("Vote — nothing is invented in the tally panel", () => {
  it("shows SIN LECTURA and no percentage when the tally is unreadable", async () => {
    mocks.fetchTally.mockResolvedValue(bad("nodo caído"));
    renderVote();
    await waitFor(() => expect(screen.getByText(/SIN LECTURA/)).toBeInTheDocument());
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("does not render a percentage bar when the tally is zero but readable", async () => {
    renderVote();
    await waitFor(() => expect(screen.getByText(/SIN VOTOS/)).toBeInTheDocument());
    expect(screen.queryByText(/PÚBLICOS: 0/)).not.toBeInTheDocument();
  });
});
