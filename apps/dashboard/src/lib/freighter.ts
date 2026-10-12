/**
 * Freighter adapter — the concrete `WalletAdapter` used by the app.
 *
 * `@stellar/freighter-api` is the official package published by Stellar Labs.
 * The import is dynamic so the dashboard still builds and its tests still run
 * in a browser without the extension installed.
 *
 * This adapter targets the v6 surface. The old code called
 * `getPublicKey({ sign: true })`, a name that does not exist in v6: the package
 * exports `getAddress`, `requestAccess`, `isAllowed`, `isConnected` and
 * `signTransaction`. Because the check was `typeof api.getPublicKey ===
 * "function"`, the module loaded and was then thrown away, so every browser
 * reported "no se pudo cargar el módulo de Freighter" with the extension
 * installed and working. Every response is also inspected for `error`, which
 * is how this package reports a rejected authorisation.
 */

import type { SignTransaction } from "@stellar/stellar-sdk/contract";
import { WalletError, type WalletAdapter } from "./wallet.js";

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

/**
 * Every v6 call resolves to its payload plus an optional `error`. A result that
 * carries an error is a failure even though the promise resolved, so the error
 * has to be read before the payload is trusted.
 */
type WithError<T> = T & { error?: { message?: string; code?: number } };

type FreighterApi = {
  isBrowser?: boolean;
  getAddress: () => Promise<WithError<{ address: string }>>;
  requestAccess: () => Promise<WithError<{ address: string }>>;
  isAllowed: () => Promise<WithError<{ isAllowed: boolean }>>;
  isConnected: () => Promise<WithError<{ isConnected: boolean }>>;
  signTransaction: (
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ) => Promise<WithError<{ signedTxXdr: string; signerAddress: string }>>;
  WatchWalletChanges?: unknown;
};

/**
 * How long the extension gets to answer.
 *
 * The package speaks to Freighter over window.postMessage and waits for a
 * reply. With no extension installed the promise never settles, so an unbounded
 * call is indistinguishable from a dead button: no error, no state, nothing.
 */
const PROBE_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 20_000;

const UNREACHABLE =
  "Freighter no respondió. Comprueba que la extensión está instalada, desbloqueada y que este sitio está permitido en su configuración.";

async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Wrapper names the module is known to sit behind.
 *
 * The package ships a UMD bundle. Vite code-splits it into a dynamic chunk and
 * Rollup re-exports it under a minified name, so the deployed chunk literally
 * ends with `export { X as i }`. The callable API can therefore sit one, two
 * or three levels in, behind `default`, behind `i`, behind `freighterApi`.
 *
 * The wrapper names are probed explicitly rather than through `Object.keys`,
 * because some containers (vitest's module proxy, Rollup's interop) report an
 * empty key list while their properties are still reachable.
 */
const WRAPPER_KEYS = ["default", "freighterApi", "module", "exports", "i"] as const;

function isFreighterApi(value: unknown): value is FreighterApi {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.getAddress === "function" && typeof v.requestAccess === "function";
}

function findApi(value: unknown, depth = 0): FreighterApi | null {
  if (!value || typeof value !== "object" || depth > 4) return null;
  if (isFreighterApi(value)) return value;
  const v = value as Record<string, unknown>;
  for (const key of WRAPPER_KEYS) {
    if (key in v) {
      const found = findApi(v[key], depth + 1);
      if (found) return found;
    }
  }
  for (const key of Object.keys(v)) {
    if ((WRAPPER_KEYS as readonly string[]).includes(key)) continue;
    const found = findApi(v[key], depth + 1);
    if (found) return found;
  }
  return null;
}

async function loadFreighter(): Promise<FreighterApi | null> {
  try {
    return findApi(await import("@stellar/freighter-api"));
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

/** Turns a resolved-but-errored response into a rejection. */
function orThrow<T extends { error?: { message?: string } }>(result: T, what: string): T {
  if (result?.error) {
    throw new WalletError(`${what}: ${result.error.message ?? "Freighter no dio más detalle"}`);
  }
  return result;
}

export const freighterAdapter: WalletAdapter = {
  name: "Freighter",

  async isAvailable(): Promise<boolean> {
    const api = await loadFreighter();
    if (!api) return false;
    // An answer of any kind means the extension is there: `isAllowed: false`
    // is installed-but-unauthorised, which is still an installed extension and
    // must not be reported as a missing wallet. A response carrying `error` is
    // the package saying it could not reach the extension at all.
    try {
      orThrow(await withTimeout(api.isAllowed(), PROBE_TIMEOUT_MS, "sonda sin respuesta"), "Sonda");
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
      const result = orThrow(
        await withTimeout(api.requestAccess(), CONNECT_TIMEOUT_MS, UNREACHABLE),
        "Freighter rechazó la autorización",
      );
      return requireAddress(result.address);
    } catch (e) {
      throw e instanceof WalletError
        ? e
        : new WalletError(e instanceof Error ? e.message : "Freighter rechazó la conexión");
    }
  },

  async restore(): Promise<string | null> {
    const api = await loadFreighter();
    if (!api) return null;
    try {
      const allowed = await withTimeout(api.isAllowed(), PROBE_TIMEOUT_MS, "sonda sin respuesta");
      if (allowed.error || !allowed.isAllowed) return null;
      const result = orThrow(await api.getAddress(), "Freighter no devolvió la dirección");
      return requireAddress(result.address);
    } catch {
      // No session, or the extension went away. Both are normal states.
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
      throw new WalletError("No se pudo cargar el módulo de Freighter: no se puede firmar");
    }
    const result = orThrow(
      await api.signTransaction(xdr, { networkPassphrase: TESTNET_PASSPHRASE }),
      "Freighter rechazó la firma",
    );
    if (!result.signedTxXdr) {
      throw new WalletError("Freighter devolvió una transacción sin firmar");
    }
    return { signedTxXdr: result.signedTxXdr };
  }) as unknown as SignTransaction,
};
