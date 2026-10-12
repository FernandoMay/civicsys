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

/**
 * How long to give the extension to answer a probe, and to answer a connect.
 *
 * The package speaks to Freighter over window.postMessage and waits. With no
 * extension installed the promise never settles, so an unbound call is
 * indistinguishable from a dead button. These bounds make the difference
 * between "installed", "not installed" and "not answering" visible.
 */
const PROBE_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 15_000;

const NO_EXTENSION_ON_CONNECT =
  "Freighter no respondió. Comprueba que la extensión está instalada, desbloqueada y que este sitio está permitido en su configuración.";

export const freighterAdapter: WalletAdapter = {
  name: "Freighter",

  async isAvailable(): Promise<boolean> {
    const api = await loadFreighter();
    if (!api) return false;
    // `window.freighter` is only a shortcut the package itself falls back from:
    // when it is absent the package still talks over postMessage. Treating the
    // missing shortcut as "no wallet" rejects installs that work fine.
    //
    // So availability is answered by the thing that matters: does the extension
    // reply to a probe? A `false` reply means installed-but-not-authorised,
    // which is still an installed extension.
    if (typeof api.isConnected !== "function") return true;
    try {
      await withTimeout(api.isConnected(), PROBE_TIMEOUT_MS, "sonda sin respuesta");
      return true;
    } catch {
      return false;
    }
  },

  async connect(): Promise<string> {
    const api = await loadFreighter();
    if (!api) {
      throw new WalletError("No se pudo cargar el módulo de Freighter. Recarga la página.");
    }
    try {
      // `sign: true` makes Freighter prompt for access when not yet authorised.
      const key = await withTimeout(
        api.getPublicKey({ sign: true }),
        CONNECT_TIMEOUT_MS,
        NO_EXTENSION_ON_CONNECT,
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
    const api = await loadFreighter();
    if (!api) return null;
    try {
      // Absence of an answer means no extension, same as the probe in
      // isAvailable(); a `false` from isConnected just means no saved session.
      if (typeof api.isConnected === "function") {
        try {
          await withTimeout(api.isConnected(), PROBE_TIMEOUT_MS, "sonda sin respuesta");
        } catch {
          return null;
        }
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