/**
 * The v6 API is not the v3 API, and that cost the whole wallet flow.
 *
 * These tests pin the names that actually exist in
 * `@stellar/freighter-api@6.0.1`: `getAddress`, `requestAccess`, `isAllowed`,
 * `isConnected`, `signTransaction`. The code used to call `getPublicKey`, a
 * name the package does not export at all, so the module loaded fine and was
 * then discarded — "no se pudo cargar el módulo de Freighter" in every browser
 * with the extension working.
 *
 * They also pin that a resolved response carrying `error` is a failure, which
 * is how v6 reports a rejected authorisation, and that a call is bounded so an
 * unreachable extension shows a message instead of a dead button.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { freighterAdapter } from "./freighter.js";

const freighterMocks = vi.hoisted(() => ({
  getAddress: vi.fn(),
  requestAccess: vi.fn(),
  isAllowed: vi.fn(),
  isConnected: vi.fn(),
  signTransaction: vi.fn(),
}));

// The exports are declared individually. Nesting them under a single `default`
// makes vitest throw "No getAddress export is defined" as soon as the adapter
// walks into the object, because the module proxy only resolves declared
// exports. The real package exports these names directly, so this matches it.
vi.mock("@stellar/freighter-api", () => ({
  getAddress: () => freighterMocks.getAddress(),
  requestAccess: () => freighterMocks.requestAccess(),
  isAllowed: () => freighterMocks.isAllowed(),
  isConnected: () => freighterMocks.isConnected(),
  signTransaction: (xdr: string, opts?: unknown) => freighterMocks.signTransaction(xdr, opts),
}));

const ADDRESS = "G" + "A".repeat(55);

beforeEach(() => {
  // `restoreAllMocks` would wipe the implementations set right below, so only
  // the recorded calls are cleared.
  vi.clearAllMocks();
  freighterMocks.isAllowed.mockResolvedValue({ isAllowed: true });
  freighterMocks.isConnected.mockResolvedValue({ isConnected: true });
  freighterMocks.getAddress.mockResolvedValue({ address: ADDRESS });
  freighterMocks.requestAccess.mockResolvedValue({ address: ADDRESS });
  freighterMocks.signTransaction.mockResolvedValue({ signedTxXdr: "signed-xdr", signerAddress: ADDRESS });
});

describe("freighterAdapter — the names v6 actually exports", () => {
  it("connects through requestAccess, not the removed getPublicKey", async () => {
    await expect(freighterAdapter.connect()).resolves.toBe(ADDRESS);
    expect(freighterMocks.requestAccess).toHaveBeenCalledOnce();
    expect(freighterMocks.getAddress).not.toHaveBeenCalled();
  });

  it("restores through getAddress once the site is allowed", async () => {
    await expect(freighterAdapter.restore()).resolves.toBe(ADDRESS);
    expect(freighterMocks.getAddress).toHaveBeenCalledOnce();
  });

  it("restores nothing when the site is not allowed", async () => {
    freighterMocks.isAllowed.mockResolvedValue({ isAllowed: false });
    await expect(freighterAdapter.restore()).resolves.toBeNull();
    expect(freighterMocks.getAddress).not.toHaveBeenCalled();
  });

  it("signs with the testnet passphrase the contracts are deployed on", async () => {
    await expect(freighterAdapter.signTransaction("unsigned-xdr")).resolves.toEqual({
      signedTxXdr: "signed-xdr",
    });
    expect(freighterMocks.signTransaction).toHaveBeenCalledWith("unsigned-xdr", {
      networkPassphrase: "Test SDF Network ; September 2015",
    });
  });
});

describe("freighterAdapter — a resolved error is still a failure", () => {
  it("rejects the connection when the user declines the authorisation", async () => {
    freighterMocks.requestAccess.mockResolvedValue({
      address: "",
      error: { message: "User declined access" },
    });
    await expect(freighterAdapter.connect()).rejects.toThrow(/declined access/);
  });

  it("rejects a signature the extension reports as failed", async () => {
    freighterMocks.signTransaction.mockResolvedValue({ signedTxXdr: "", error: { message: "rechazada" } });
    await expect(freighterAdapter.signTransaction("x")).rejects.toThrow(/rechazada/);
  });

  it("rejects an answer that is not a Stellar address", async () => {
    freighterMocks.requestAccess.mockResolvedValue({ address: "not-an-address" });
    await expect(freighterAdapter.connect()).rejects.toThrow(/dirección pública válida/);
  });
});

describe("freighterAdapter — availability", () => {
  it("reports available when the extension answers, even with isAllowed false", async () => {
    // Installed but not yet authorised for this site: still an installed
    // extension, and calling it missing hides a wallet that works.
    freighterMocks.isAllowed.mockResolvedValue({ isAllowed: false });
    expect(await freighterAdapter.isAvailable()).toBe(true);
  });

  it("reports unavailable when the probe errors", async () => {
    freighterMocks.isAllowed.mockResolvedValue({ isAllowed: false, error: { message: "no extension" } });
    expect(await freighterAdapter.isAvailable()).toBe(false);
  });

  // An extension that never replies used to hang forever, which is
  // indistinguishable from the button doing nothing.
  it("fails loudly instead of hanging when the extension never answers", async () => {
    vi.useFakeTimers();
    freighterMocks.requestAccess.mockReturnValue(new Promise(() => {}));
    const attempt = freighterAdapter.connect().then(
      () => "resolved",
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    await vi.advanceTimersByTimeAsync(20_500);
    const outcome = await attempt;
    vi.useRealTimers();
    expect(outcome).toMatch(/no respondió|permitido/i);
  });
});
