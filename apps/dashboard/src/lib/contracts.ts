/**
 * Typed contract clients.
 *
 * `@stellar/stellar-sdk`'s `Client.fromWasmHash<T>()` returns `Client & T`, so
 * the call surface is typed by us rather than generated. These interfaces mirror
 * the on-chain entrypoints declared in
 * `contracts/brujula-vote/src/lib.rs` (RFC BRUJULA-CIVICA-ARCH-001 §3.3).
 *
 * Keeping them here — rather than inline in a view — means a signature change in
 * the contract breaks the build in exactly one place.
 */

import { Client, type AssembledTransaction, type MethodOptions } from "@stellar/stellar-sdk/contract";

import { deployment, RPC_URL } from "./chain.js";
import type { SignTransaction } from "./wallet.js";

/** `brujula-vote` — only the entrypoints the dashboard actually calls. */
export interface BrujulaVoteContract {
  cast_public(
    args: { proposal_id: bigint; voter: string; choice: number },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<unknown>>;
  has_voted_public(
    args: { proposal_id: bigint; voter: string },
    options?: MethodOptions,
  ): Promise<unknown>;
}

/** `brujula-identity` — admin-only issuance is deliberately not exposed to the UI. */
export interface BrujulaIdentityContract {
  get_credential(
    args: { subject: string },
    options?: MethodOptions,
  ): Promise<unknown>;
}

export type VoteClient = Client & BrujulaVoteContract;

export async function voteClient(
  publicKey: string,
  signTransaction: SignTransaction,
): Promise<VoteClient> {
  const c = deployment.contracts["brujula-vote"];
  if (!c) throw new Error("deployment record missing brujula-vote");
  return Client.fromWasmHash<BrujulaVoteContract>(
    c.wasm_sha256,
    {
      contractId: c.contract_id,
      networkPassphrase: deployment.network_passphrase,
      rpcUrl: RPC_URL,
      allowHttp: RPC_URL.startsWith("http:"),
      publicKey,
      signTransaction,
    },
    "hex",
  );
}