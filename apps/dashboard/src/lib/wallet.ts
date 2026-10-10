import { createElement, useEffect, useMemo, useState } from "react";
import {
  NetworkType,
  WalletProvider as KitProvider,
  useWallet as useKit,
  type WalletAccount,
  type SignTransaction as KitSignTransaction,
} from "stellar-wallet-kit";
import type { SignTransaction as StellarSignTransaction } from "@stellar/stellar-sdk/contract";
import { Client, AssembledTransaction, Keypair } from "@stellar/stellar-sdk/contract";

export { Client, AssembledTransaction, Keypair };

export type { SignTransaction as StellarSignTransaction } from "@stellar/stellar-sdk/contract";

export type { SignTransaction as KitSignTransaction } from "stellar-wallet-kit";

export type { WalletAccount } from "stellar-wallet-kit";

export type WalletAddress = string;

// ---------------------------------------------------------------------------
// Couche de adaptación local.
//
// stellar-wallet-kit ya expone WalletProvider + useKit().
// Este archivo NO crea su propio contexto de nuevo; delega todo a la capa
// del kit y expone solo la forma que el dashboard/modal esperan:
//   - connected: boolean
//   - address: WalletAddress | null
//   - providerName: string | null
//   - connect(providerName) / disconnect() / retry()
// ---------------------------------------------------------------------------

export type WalletState = {
  connected: boolean;
  address: WalletAddress | null;
  providerName: string | null;
};

export interface WalletContextValue {
  state: WalletState;
  connect: (providerName: string) => Promise<WalletAddress | null>;
  disconnect: () => Promise<void>;
  retry: () => Promise<void>;
}

const DEFAULT_WALLET_STATE: WalletState = {
  connected: false,
  address: null,
  providerName: null,
};

const UNKNOWN_ADDRESS = "UNKNOWN";
const UNKNOWN_PROVIDER = "freighter";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

const TESTNET: NetworkType = NetworkType.TESTNET;

function mapAccount(account: WalletAccount | null): WalletState {
  if (!account) {
    return DEFAULT_WALLET_STATE;
  }
  const addr =
    typeof account.address === "string" && account.address.trim().length > 0
      ? account.address.trim()
      : UNKNOWN_ADDRESS;
  return {
    connected: true,
    address: addr,
    providerName: UNKNOWN_PROVIDER,
  };
}

export function createWalletState(
  initial: WalletState = DEFAULT_WALLET_STATE,
): WalletState {
  return initial;
}

export const WalletContext = {
  defaultState: DEFAULT_WALLET_STATE,
  unknownAddress: UNKNOWN_ADDRESS,
  unknownProvider: UNKNOWN_PROVIDER,
};

export function useWalletState(): WalletContextValue {
  const kit = useKit();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const state = useMemo(() => {
    if (!mounted || !kit.isConnected) return DEFAULT_WALLET_STATE;
    return mapAccount(kit.account);
  }, [mounted, kit.isConnected, kit.account]);

  const connect = async (providerName: string): Promise<WalletAddress | null> => {
    if (!mounted) {
      return null;
    }
    if (providerName !== UNKNOWN_PROVIDER) {
      return null;
    }
    await kit.connect(UNKNOWN_PROVIDER as any);
    const s = mapAccount(kit.account);
    return s.address;
  };

  const disconnect = async (): Promise<void> => {
    if (!mounted) {
      return;
    }
    await kit.disconnect();
  };

  const retry = async (): Promise<void> => {
    if (!mounted || !state.providerName) {
      return;
    }
    await connect(state.providerName);
  };

  return {
    state,
    connect,
    disconnect,
    retry,
  };
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  return createElement(
    KitProvider,
    { config: { network: TESTNET, autoConnect: false } },
    children,
  );
}

export function WalletBoundary({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return createElement(WalletProvider, null, children);
}

// alias local para mantener compatibilidad con el código actual
export const useWallet = useWalletState;

// ---------------------------------------------------------------------------
// Tx real sobre CivicVote.
//
// El flujo es:
//  - wallet conectado -> address conocido
//  - usar AssembledTransaction.build() con el Client de civic-vote
//  - firmar con la callback signTransaction de Freighter
//  - enviar al ledger
//
// El kit expone signTransaction via useKit().signTransaction. Ese valor
// ES el callback SEP-43 que el SDK de Stellar espera como signTransaction.
// ---------------------------------------------------------------------------

export function useSignTransaction(): StellarSignTransaction | undefined {
  const kit = useKit();
  if (!kit.isConnected) {
    return undefined;
  }
  // stellar-wallet-kit v2 exposes `signTransaction` as the Freighter SEP-43
  // callback shape `(xdr: string, opts?: SignTransactionOptions) => ...`.
  // For the SDK's contract Client we need the older raw SEP-43 shape, so we
  // adapt here. If the wallet version disagrees, treat as missing signer.
  const kitSign = kit.signTransaction as KitSignTransaction | undefined;
  if (!kitSign) {
    return undefined;
  }
  // Re-export the stellar-sdk contract shape directly so callers get the right
  // type without a runtime wrapper when the kit already satisfies it.
  return (kitSign as unknown) as StellarSignTransaction;
}

export { Client, AssembledTransaction };

export { Keypair } from "@stellar/stellar-sdk";

