/**
 * Regression guard for the single most dangerous bug in the old dashboard.
 *
 * `CredentialModal.handleConfirm` used to be `setVerified(true)` plus an
 * `alert()`. It rendered "[HABILITADA PARA VOTAR]" for ANY input, without ever
 * contacting the chain. These tests make that impossible to reintroduce: the
 * only path to an eligibility claim is a successful chain read.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CredentialModal from "./CredentialModal.js";
import { WalletProvider, type WalletAdapter } from "../lib/wallet.js";

const fetchCredential = vi.hoisted(() => vi.fn());
vi.mock("../lib/chain.js", () => ({ fetchCredential }));

/** A syntactically valid G address: "G" + exactly 55 base32 characters. */
const ADDR = "G" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW".slice(0, 55);

const adapter: WalletAdapter = {
  name: "fake",
  isAvailable: async () => true,
  connect: async () => ADDR,
  restore: async () => null,
  disconnect: async () => {},
  signTransaction: (async () => ({ signedTxXdr: "" })) as never,
};

function renderModal() {
  return render(
    <WalletProvider adapter={adapter}>
      <CredentialModal onClose={() => {}} />
    </WalletProvider>,
  );
}

beforeEach(() => {
  fetchCredential.mockReset();
});

describe("CredentialModal", () => {
  it("claims nothing before any lookup", () => {
    renderModal();
    expect(screen.getByText(/SIN CONSULTAR/)).toBeInTheDocument();
    expect(screen.queryByText(/HABILITADA PARA VOTAR/)).toBeNull();
  });

  it("rejects a non-Stellar address without querying the chain", async () => {
    const user = userEvent.setup();
    renderModal();
    const input = screen.getByLabelText(/DIRECCIÓN PÚBLICA/i);
    await user.clear(input);
    await user.type(input, "no-soy-una-direccion");
    await user.click(screen.getByRole("button", { name: /Verificar en cadena/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(fetchCredential).not.toHaveBeenCalled();
    expect(screen.queryByText(/HABILITADA PARA VOTAR/)).toBeNull();
  });

  it("says SIN CREDENCIAL when the chain has no record", async () => {
    const user = userEvent.setup();
    fetchCredential.mockResolvedValue({
      credential: { status: "ok", value: null, evidence: ev() },
      eligible: { status: "ok", value: false, evidence: ev() },
    });
    renderModal();
    await verify(user);

    await waitFor(() => expect(screen.getByText(/SIN CREDENCIAL/)).toBeInTheDocument());
    expect(screen.queryByText(/HABILITADA PARA VOTAR/)).toBeNull();
  });

  it("reports HABILITADA only when the chain confirms ACTIVE + eligible", async () => {
    const user = userEvent.setup();
    fetchCredential.mockResolvedValue({
      credential: {
        status: "ok",
        value: {
          subject: ADDR,
          commitment: "a".repeat(64),
          credential_type: "citizen",
          status: 0,
          eligible: true,
          issued_at: 1_700_000_000n,
          updated_at: 1_700_000_000n,
        },
        evidence: ev(),
      },
      eligible: { status: "ok", value: true, evidence: ev() },
    });
    renderModal();
    await verify(user);

    await waitFor(() =>
      expect(screen.getByText(/HABILITADA PARA VOTAR/)).toBeInTheDocument(),
    );
    expect(screen.getByText("ACTIVA")).toBeInTheDocument();
  });

  it("reports REVOCADA and denies eligibility even if the flag says true", async () => {
    const user = userEvent.setup();
    fetchCredential.mockResolvedValue({
      credential: {
        status: "ok",
        value: {
          subject: ADDR,
          commitment: "a".repeat(64),
          credential_type: "citizen",
          status: 2, // REVOKED
          eligible: true,
          issued_at: 1n,
          updated_at: 1n,
        },
        evidence: ev(),
      },
      // A revoked credential must never come back as eligible from the chain;
      // if it ever did, the UI still refuses to call it HABILITADA.
      eligible: { status: "ok", value: true, evidence: ev() },
    });
    renderModal();
    await verify(user);

    await waitFor(() =>
      // Two places say REVOCADA on purpose: the eligibility verdict and the
      // credential status. Both must agree, so assert on both.
      expect(screen.getByText(/REVOCADA — DEFINITIVO/)).toBeInTheDocument(),
    );
    expect(screen.getByText("REVOCADA")).toBeInTheDocument();
    expect(screen.queryByText(/HABILITADA PARA VOTAR/)).toBeNull();
  });

  it("reports DESCONOCIDO when the chain read fails", async () => {
    const user = userEvent.setup();
    fetchCredential.mockResolvedValue({
      credential: { status: "unknown", reason: "timeout del rpc", evidence: ev() },
      eligible: { status: "unknown", reason: "timeout del rpc", evidence: ev() },
    });
    renderModal();
    await verify(user);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("timeout del rpc"));
    expect(screen.queryByText(/HABILITADA PARA VOTAR/)).toBeNull();
  });
});

async function verify(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByLabelText(/DIRECCIÓN PÚBLICA/i);
  await user.clear(input);
  await user.type(input, ADDR);
  await user.click(screen.getByRole("button", { name: /Verificar en cadena/i }));
}

function ev() {
  return {
    contractId: "CABC",
    rpcUrl: "https://example.invalid",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    ledger: 1,
  };
}