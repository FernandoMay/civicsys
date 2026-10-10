/**
 * Wallet boundary for Brújula Cívica.
 *
 * Design rule (RFC BRUJULA-CIVICA-ARCH-001 §0): the dashboard never invents an
 * identity. A voter's address comes from a real wallet extension or is
 * `null` — it is never a placeholder, a demo string, or a hardcoded key.
 *
 * The concrete adapter (Freighter, first-party `@stellar/freighter-api`) is
 * injected through React context so:
 *   - views depend on `useWallet()`, not on a vendor SDK;
 *   - tests can supply a deterministic fake adapter without a browser extension.
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { SignTransaction } from "@stellar/stellar-sdk/contract";

export type { SignTransaction };

/** A G… Stellar account address, or `null` when no wallet is connected. */
export type WalletAddress = string | null;

export interface WalletAdapter {
  /** Human-readable adapter name, shown in the UI and in errors. */
  readonly name: string;
  /** `false` when the extension is not installed / not detected. */
  isAvailable(): Promise<boolean>;
  /** Requests access. Resolves to the connected public key (G…). */
  connect(): Promise<string>;
  /** Returns the already-authorised public key, or `null` if not authorised. */
  restore(): Promise<string | null>;
  /** Clears the authorisation held by the adapter. */
  disconnect(): Promise<void>;
  /** SEP-43 signing callback expected by `@stellar/stellar-sdk`'s `Client`. */
  signTransaction: SignTransaction;
}

export interface WalletContextValue {
  /** `null` until `connect()` resolves. Drives every "who am I" label. */
  address: WalletAddress;
  /** Adapter in use. Always present: the provider requires one. */
  adapter: WalletAdapter;
  /** `false` when no adapter is available in this browser at all. */
  available: boolean | null;
  /** Last connection error, or `null`. Never swallowed — silent failures are claims. */
  error: string | null;
  connecting: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/** Thrown to surface a connection failure instead of silently doing nothing. */
export class WalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletError";
  }
}

export function WalletProvider({
  adapter,
  children,
}: {
  adapter: WalletAdapter;
  children: ReactNode;
}) {
  const [address, setAddress] = useState<WalletAddress>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Probe availability and try a silent restore on mount. Both outcomes are
  // reported honestly: `available: false` means "no extension", not "unknown".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ok = await adapter.isAvailable();
        if (cancelled) return;
        setAvailable(ok);
        if (!ok) return;
        const existing = await adapter.restore();
        if (!cancelled) setAddress(existing);
      } catch (e) {
        if (!cancelled) {
          setAvailable(false);
          setError(describe(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const addr = await adapter.connect();
      setAddress(addr);
    } catch (e) {
      // Rejected by the user, or the extension vanished. Keep `address` null
      // so no view can render a stale or fabricated identity.
      setAddress(null);
      setError(describe(e));
      throw e;
    } finally {
      setConnecting(false);
    }
  }, [adapter]);

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await adapter.disconnect();
    } catch (e) {
      setError(describe(e));
    } finally {
      setAddress(null);
    }
  }, [adapter]);

  const value = useMemo<WalletContextValue>(
    () => ({ address, adapter, available, error, connecting, connect, disconnect }),
    [address, adapter, available, error, connecting, connect, disconnect],
  );

  return createElement(WalletContext.Provider, { value }, children);
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}

/**
 * The signer handed to the contract `Client`.
 *
 * `null` when no wallet is connected — callers must treat that as "cannot
 * submit a transaction", never as "sign anyway".
 */
export function useSignTransaction(): SignTransaction | null {
  const { adapter, address } = useWallet();
  return useMemo(() => {
    if (!address) return null;
    return adapter.signTransaction;
  }, [adapter, address]);
}

export function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "error desconocido en la cartera";
}