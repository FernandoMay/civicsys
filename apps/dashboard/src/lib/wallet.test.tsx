import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WalletProvider, useWallet, type WalletAdapter } from "./wallet.js";

const ADDR = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW2";

function makeAdapter(over: Partial<WalletAdapter> = {}): WalletAdapter {
  return {
    name: "fake",
    isAvailable: async () => true,
    connect: async () => ADDR,
    restore: async () => null,
    disconnect: async () => {},
    signTransaction: (async () => ({ signedTxXdr: "" })) as never,
    ...over,
  };
}

function Probe() {
  const { address, available, error, connecting, connect, disconnect } = useWallet();
  return (
    <div>
      <span data-testid="address">{address ?? "NULL"}</span>
      <span data-testid="available">{String(available)}</span>
      <span data-testid="error">{error ?? "NO_ERROR"}</span>
      <span data-testid="connecting">{String(connecting)}</span>
      {/* connect() re-throws so imperative callers can react; the UI only needs
          the state, so the click handler deliberately swallows it. */}
      <button onClick={() => void connect().catch(() => {})}>conectar</button>
      <button onClick={() => void disconnect()}>desconectar</button>
    </div>
  );
}

function renderWith(adapter: WalletAdapter) {
  return render(
    <WalletProvider adapter={adapter}>
      <Probe />
    </WalletProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("WalletProvider", () => {
  it("never invents an address: starts null even when the adapter is fine", async () => {
    renderWith(makeAdapter());
    // Before any authorisation the address must be null, never a placeholder.
    expect(screen.getByTestId("address")).toHaveTextContent("NULL");
    await waitFor(() => expect(screen.getByTestId("available")).toHaveTextContent("true"));
    expect(screen.getByTestId("address")).toHaveTextContent("NULL");
  });

  it("restores an already-authorised address on mount", async () => {
    renderWith(makeAdapter({ restore: async () => ADDR }));
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent(ADDR));
  });

  it("sets the real address after connect", async () => {
    const user = userEvent.setup();
    renderWith(makeAdapter());
    await user.click(screen.getByRole("button", { name: "conectar" }));
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent(ADDR));
  });

  it("reports available=false when no extension is present", async () => {
    renderWith(makeAdapter({ isAvailable: async () => false }));
    await waitFor(() => expect(screen.getByTestId("available")).toHaveTextContent("false"));
  });

  it("surfaces a rejected connection instead of silently keeping an identity", async () => {
    const user = userEvent.setup();
    const adapter = makeAdapter({
      connect: async () => {
        throw new Error("el usuario rechazó la firma");
      },
    });
    renderWith(adapter);
    await user.click(screen.getByRole("button", { name: "conectar" }));

    await waitFor(() =>
      expect(screen.getByTestId("error")).toHaveTextContent("el usuario rechazó la firma"),
    );
    expect(screen.getByTestId("address")).toHaveTextContent("NULL");
  });

  it("clears the address on disconnect", async () => {
    const user = userEvent.setup();
    renderWith(makeAdapter({ restore: async () => ADDR }));
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent(ADDR));

    await user.click(screen.getByRole("button", { name: "desconectar" }));
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("NULL"));
  });

  it("throws a useful error when used outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/useWallet must be used inside/);
    spy.mockRestore();
  });
});

describe("useSignTransaction", () => {
  function SignProbe() {
    const { address } = useWallet();
    return <span data-testid="signed">{address ? "SIGNS" : "NO_SIGNS"}</span>;
  }

  it("offers a signer only once a wallet is connected", async () => {
    await act(async () => {
      render(
        <WalletProvider adapter={makeAdapter({ restore: async () => ADDR })}>
          <SignProbe />
        </WalletProvider>,
      );
    });
    await waitFor(() => expect(screen.getByTestId("signed")).toHaveTextContent("SIGNS"));
  });
});