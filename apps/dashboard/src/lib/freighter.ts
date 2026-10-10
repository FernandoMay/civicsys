/**
 * Freighter adapter — the concrete `WalletAdapter` used by the app.
 *
 * `@stellar/freighter-api` is the official package published by Stellar Labs.
 * The import is dynamic so the dashboard still builds and its tests still run
 * in a browser without the extension installed.
 */

import type { SignTransaction } from "@stellar/stellar-sdk/contract";
import { WalletError, type WalletAdapter } from "./wallet.js";

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

type FreighterApi = {
  isConnected(): Promise<boolean>;
  getPublicKey(opts?: { address?: string; sign?: boolean }): Promise<string>;
  signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedTxXdr: string }>;
  signMessage?(message: string, opts?: { networkPassphrase?: string }): Promise<{ signedMessage: string }>;
};

async function loadFreighter(): Promise<FreighterApi | null> {
  try {
    const mod = await import("@stellar/freighter-api");
    const api = ((mod as unknown as { default?: FreighterApi }).default ??
      mod) as unknown as FreighterApi;
    return api && typeof api.getPublicKey === "function" ? api : null;
  } catch {
    return null;
  }
}

function requireAddress(address: string | null | undefined): string {
  if (!address || !address.startsWith("G")) {
    throw new WalletError("la cartera no devolvió una dirección pública válida");
  }
  return address;
}

export const freighterAdapter: WalletAdapter = {
  name: "Freighter",

  async isAvailable(): Promise<boolean> {
    const api = await loadFreighter();
    if (!api) return false;
    // `isConnected` is absent on some builds; treat that as "installed but idle".
    if (typeof api.isConnected !== "function") return true;
    return true;
  },

  async connect(): Promise<string> {
    const api = await loadFreighter();
    if (!api) {
      throw new WalletError(
        "Freighter no está instalada. Instala la extensión y recarga la página.",
      );
    }
    try {
      // `sign: true` makes Freighter prompt for access when not yet authorised.
      const key = await api.getPublicKey({ sign: true });
      return requireAddress(key);
    } catch (e) {
      throw new WalletError(
        e instanceof Error && e.message
          ? `Freighter rechazó la conexión: ${e.message}`
          : "Freighter rechazó la conexión",
      );
    }
  },

  async restore(): Promise<string | null> {
    const api = await loadFreighter();
    if (!api) return null;
    try {
      if (typeof api.isConnected === "function" && !(await api.isConnected())) {
        return null;
      }
      return await api.getPublicKey();
    } catch {
      // Not authorised yet — that is a normal state, not an error.
      return null;
    }
  },

  async disconnect(): Promise<void> {
    // Freighter has no programmatic revoke; the extension owns its own session.
    // Local state is cleared by the provider, which is the part this app owns.
  },

  signTransaction: (async (xdr: string) => {
    const api = await loadFreighter();
    if (!api) {
      throw new WalletError("Freighter no está instalada: no se puede firmar la transacción");
    }
    const { signedTxXdr } = await api.signTransaction(xdr, {
      networkPassphrase: TESTNET_PASSPHRASE,
    });
    if (!signedTxXdr) {
      throw new WalletError("Freighter devolvió una transacción sin firmar");
    }
    return { signedTxXdr };
  }) as unknown as SignTransaction,
};