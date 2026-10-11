/**
 * The proposal composer is the only flow that spends funds AND publishes
 * off-chain content, so its ordering matters as much as its result:
 *
 *   1. validate in the browser,
 *   2. pin the exact bytes to IPFS,
 *   3. only then ask for a signature,
 *   4. re-read the record and prove the CID + hashes landed.
 *
 * The old dashboard had no composer at all: proposal CIDs were a constant, so
 * nothing here existed to break. These tests pin the parts that are easy to get
 * subtly wrong — signing before the content exists, claiming success without a
 * re-read, and reusing a hash across different fields.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProposalComposer from "./ProposalComposer.js";
import { WalletProvider, type WalletAdapter } from "../lib/wallet.js";
import { sha256Utf8 } from "@brugulacivica/sdk";

const mocks = vi.hoisted(() => ({
  reader: { nextProposalId: vi.fn(), getProposal: vi.fn() },
  proposalClient: vi.fn(),
}));
vi.mock("../lib/chain.js", () => ({ reader: mocks.reader }));
vi.mock("../lib/contracts.js", () => ({ proposalClient: mocks.proposalClient, voteClient: vi.fn() }));

const TITLE = "Presupuesto participativo 2026";
const DESCRIPTION = "Destinar el 5% del presupuesto a proyectos elegidos por votación.";
const METADATA = '{"district":"00"}';

/** A syntactically valid G address: "G" + exactly 55 base32 characters. */
const ADDR = "G" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW".slice(0, 55);

const evidence = {
  contractId: "CABC",
  rpcUrl: "https://example.invalid",
  fetchedAt: "2026-01-01T00:00:00.000Z",
  ledger: 1,
};

const ok = <T,>(value: T) => ({ status: "ok" as const, value, evidence });

/** A wallet that can actually sign, which the composer must require. */
const fundedAdapter: WalletAdapter = {
  name: "fake",
  isAvailable: async () => true,
  connect: async () => ADDR,
  restore: async () => ADDR,
  disconnect: async () => {},
  signTransaction: (async () => ({ signedTxXdr: "" })) as never,
};

const originalFetch = globalThis.fetch;

/**
 * Submits the composer's form.
 *
 * jsdom does not translate a click on a `<button type="submit">` into a form
 * submission, so the event is fired directly. The production flow in a real
 * browser does dispatch it on click; this only compensates for the test DOM.
 */
function submitForm() {
  const form = document.querySelector("form");
  if (!form) throw new Error("el formulario del compositor no está montado");
  fireEvent.submit(form);
}

/** Opens the collapsed form so the fields are on screen. */
async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Crear iniciativa/i }));
}

/**
 * Types a value into a controlled input.
 *
 * `userEvent.type` interprets `[` and `{` as key descriptors, which is exactly
 * what JSON metadata is made of, so values that are not plain prose are set
 * through a change event instead. React's controlled inputs pick it up the
 * same way a paste would.
 */
function fill(label: RegExp, value: string) {
  const input = screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;
  fireEvent.change(input, { target: { value } });
}

async function fillValidProposal() {
  fill(/Título/i, TITLE);
  fill(/Descripción/i, DESCRIPTION);
  fill(/Metadatos/i, METADATA);
}

/** The exact bytes the IPFS function is asked to pin. */
function pinnedContent(call: unknown[]) {
  const [, init] = call as [string, RequestInit];
  return JSON.parse(String(init.body)).content as string;
}

function renderComposer(onCreated = vi.fn()) {
  return {
    onCreated,
    ...render(
      <WalletProvider adapter={fundedAdapter}>
        <ProposalComposer onCreated={onCreated} />
      </WalletProvider>,
    ),
  };
}

/**
 * A single `fetch` stub for the whole file, whose BEHAVIOUR each test can swap.
 * Stubbing a fresh `vi.fn` per test silently kept the previous implementation
 * in place, which made the "pin failed" cases receive a good pin and then fail
 * the assertion for the wrong reason.
 */
type PinResponse = { ok: boolean; json: () => Promise<Record<string, unknown>> };
let pinResponder: () => PinResponse = () => ({
  ok: true,
  json: async () => ({ cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi", size: 120 }),
});


beforeEach(() => {
  vi.clearAllMocks();
  // Reset the responder too: a test that made the pin fail must not leak that
  // behaviour into the next one.
  pinResponder = () => ({
    ok: true,
    json: async () => ({ cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi", size: 120 }),
  });
  mocks.reader.nextProposalId.mockResolvedValue(ok(4n));
  mocks.reader.getProposal.mockResolvedValue(ok(null));
  vi.stubGlobal("fetch", vi.fn(async () => pinResponder()));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
});

describe("ProposalComposer — validation before any network call", () => {
  it("refuses an empty title without touching IPFS or the chain", async () => {
    const user = userEvent.setup();
    renderComposer();
    await openForm(user);
    fill(/Descripción/i, DESCRIPTION);
    submitForm();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/obligatorios/i));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.proposalClient).not.toHaveBeenCalled();
  });

  it("refuses metadata that is not a JSON object", async () => {
    const user = userEvent.setup();
    renderComposer();
    await openForm(user);
    await user.type(screen.getByLabelText(/Título/i), TITLE);
    fill(/Descripción/i, DESCRIPTION);
    fill(/Metadatos/i, "[1,2,3]");
    submitForm();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/objeto JSON/i));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("refuses a window that closes in the past", async () => {
    const user = userEvent.setup();
    renderComposer();
    await openForm(user);
    fillValidProposal();
    await user.clear(screen.getByLabelText(/Cierra/i));
    await user.type(screen.getByLabelText(/Cierra/i), "2020-01-01T00:00");
    submitForm();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/ventana/i));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("ProposalComposer — IPFS is pinned before a signature is requested", () => {
  it("pins the content and only then signs the create call", async () => {
    const user = userEvent.setup();
    const cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
    // The hashes the composer computes locally, so the re-read below finds a
    // record that genuinely matches what was anchored.
    const [titleHash, descriptionHash, metadataHash] = await Promise.all([
      sha256Utf8(TITLE),
      sha256Utf8(DESCRIPTION),
      sha256Utf8(METADATA),
    ]);
    const signAndSend = vi.fn().mockResolvedValue({ sendTransactionResponse: { hash: "tx1" } });
    const create = vi.fn().mockResolvedValue({ signAndSend });
    mocks.proposalClient.mockResolvedValue({ create });
    // next_id advances by exactly one, so the composer scans the single id the
    // create call allocated. Returning the same value twice would leave it with
    // an empty range and nothing to verify, which is a different (also honest)
    // outcome.
    mocks.reader.nextProposalId.mockResolvedValueOnce(ok(4n));
    mocks.reader.nextProposalId.mockResolvedValueOnce(ok(5n));
    mocks.reader.getProposal.mockResolvedValue(
      ok({
        id: 5n,
        proposer: ADDR,
        content_cid: cid,
        title_hash: titleHash,
        description_hash: descriptionHash,
        metadata_hash: metadataHash,
        evidence_root: "",
        created_at: 1n,
        opens_at: 1n,
        closes_at: 2n,
        cancelled: false,
        cancel_reason_hash: null,
        evidence: [],
      }),
    );
    const { onCreated } = renderComposer();

    await openForm(user);
    fillValidProposal();
    submitForm();

    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/.netlify/functions/pin-proposal",
      expect.objectContaining({ method: "POST" }),
    );

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(screen.getByRole("status")).toHaveTextContent(/creada y releída/i);
    expect(screen.getByRole("status")).toHaveTextContent(/bafybeigdyrzt/);
  });

  it("pins the exact schema the reader will later verify", async () => {
    const user = userEvent.setup();
    mocks.proposalClient.mockResolvedValue({ create: vi.fn().mockResolvedValue({ signAndSend: vi.fn().mockResolvedValue({ sendTransactionResponse: { hash: "tx" }, getTransactionResponse: { latestLedger: 1 } }) }) });
    renderComposer();

    await openForm(user);
    fillValidProposal();
    submitForm();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const content = JSON.parse(pinnedContent(calls[0]!));
    expect(content.schema).toBe("brujula-civica/proposal-content@1");
    expect(content.title).toBe(TITLE);
    expect(content.description).toBe(DESCRIPTION);
  });
});

describe("ProposalComposer — failure never claims success", () => {
  it("does not sign anything when the IPFS pin fails", async () => {
    const user = userEvent.setup();
    pinResponder = () => ({ ok: false, json: async () => ({ error: "límite alcanzado" }) });
    renderComposer();

    await openForm(user);
    fillValidProposal();
    submitForm();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/límite alcanzado/i));
    expect(mocks.proposalClient).not.toHaveBeenCalled();
  });

  it("does not sign when next_id cannot be read, and keeps the CID", async () => {
    const user = userEvent.setup();
    mocks.reader.nextProposalId.mockResolvedValue({
      status: "unknown",
      reason: "nodo caído",
      evidence,
    });
    renderComposer();

    await openForm(user);
    fillValidProposal();
    submitForm();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/no se envió la transacción/i));
    // Fail-closed: it says the CID must be kept, it just does not echo it back.
    expect(screen.getByRole("alert")).toHaveTextContent(/Conserva el CID/i);
    expect(mocks.proposalClient).not.toHaveBeenCalled();
  });

  it("does not claim success when the re-read finds no matching record", async () => {
    const user = userEvent.setup();
    mocks.proposalClient.mockResolvedValue({ create: vi.fn().mockResolvedValue({ signAndSend: vi.fn().mockResolvedValue({ sendTransactionResponse: { hash: "tx" }, getTransactionResponse: { latestLedger: 1 } }) }) });
    mocks.reader.nextProposalId.mockResolvedValue(ok(4n));
    mocks.reader.getProposal.mockResolvedValue(ok(null)); // nothing to verify against

    renderComposer();
    await openForm(user);
    fillValidProposal();
    submitForm();

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    // Must say the record could not be verified, not that it was created.
    expect(screen.getByRole("status")).toHaveTextContent(/la relectura no encontró un registro coincidente/i);
    expect(screen.queryByText(/creada y releída/i)).toBeNull();
  });

  it("surfaces a wallet rejection instead of resetting the form silently", async () => {
    const user = userEvent.setup();
    mocks.proposalClient.mockResolvedValue({
      create: vi.fn().mockRejectedValue(new Error("la cartera rechazó la firma")),
    });
    renderComposer();

    await openForm(user);
    fillValidProposal();
    submitForm();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/la cartera rechazó la firma/i),
    );
    expect(screen.queryByText(/creada y releída/i)).toBeNull();
  });
});
