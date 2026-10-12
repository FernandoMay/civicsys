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

/**
 * A promise that rejects instead of hanging.
 *
 * The Freighter package talks to the extension over window.postMessage and
 * waits for a reply. With no reply the promise simply never settles, so a click
 * on "connect" looked like nothing at all: no error, no state change, nothing.
 * A bound that fails loudly is the only honest behaviour here.
 */
async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new WalletError(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Milliseconds Freighter gets to answer before we call it unreachable. */
const CONNECT_TIMEOUT_MS = 15_000;

export const freighterAdapter: WalletAdapter = {
  name: "Freighter",

  async isAvailable(): Promise<boolean> {
    // The extension injects `window.freighter`. The npm package imports fine
    // without it, so testing only the import reports a wallet that is not
    // there, which is how "Conectar cartera" ended up enabled in browsers with
    // no Freighter installed.
    if (typeof window === "undefined") return false;
    return typeof (window as { freighter?: unknown }).freighter !== "undefined";
  },

  async connect(): Promise<string> {
    if (typeof window === "undefined" || typeof (window as { freighter?: unknown }).freighter === "undefined") {
      throw new WalletError(
        "Freighter no está instalada. Instala la extensión desde freighter.app y recarga esta página.",
      );
    }
    const api = await loadFreighter();
    if (!api) {
      throw new WalletError("No se pudo cargar el módulo de Freighter. Recarga la página.");
    }
    try {
      // `sign: true` makes Freighter prompt for access when not yet authorised.
      const key = await withTimeout(
        api.getPublicKey({ sign: true }),
        CONNECT_TIMEOUT_MS,
        "Freighter no respondió en 15 segundos. Comprueba que la extensión está desbloqueada y que este sitio está permitido.",
      );
      return requireAddress(key);
    } catch (e) {
      throw e instanceof WalletError
        ? e
        : new WalletError(
            e instanceof Error && e.message
              ? `Freighter rechazó la conexión: ${e.message}`
              : "Freighter rechazó la conexión",
          );
    }
  },

  async restore(): Promise<string | null> {
    if (typeof window === "undefined") return null;
    if (typeof (window as { freighter?: unknown }).freighter === "undefined") return null;
    const api = await loadFreighter();
    if (!api) return null;
    try {
      if (typeof api.isConnected === "function" && !(await api.isConnected())) {
        return null;
      }
      const key = await withTimeout(
        api.getPublicKey(),
        10_000,
        "Freighter no respondió al comprobar la sesión.",
      );
      return requireAddress(key);
    } catch {
      // Not authorised yet, or the extension went away. Both are normal states.
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