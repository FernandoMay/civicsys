import type { DeploymentRecord } from "./types.js";
import { CONTRACT_NAMES } from "./types.js";

/** Public Soroban RPC for Stellar testnet. */
export const DEFAULT_TESTNET_RPC = "https://soroban-testnet.stellar.org";

export function rpcUrlFromEnv(fallback: string = DEFAULT_TESTNET_RPC): string {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.CIVICSYS_RPC_URL || fallback;
}

/**
 * Validate a deployment evidence record. Throws on anything unverifiable —
 * an unproven deployment must never be treated as real (RFC §0.4).
 */
export function parseDeployment(raw: unknown): DeploymentRecord {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("deployment record is not an object");
  }
  const d = raw as Partial<DeploymentRecord>;
  for (const f of ["schema", "network", "network_passphrase", "source_account"] as const) {
    if (typeof d[f] !== "string" || d[f] === "") {
      throw new Error(`deployment record missing field: ${f}`);
    }
  }
  if (typeof d.contracts !== "object" || d.contracts === null) {
    throw new Error("deployment record missing contracts");
  }
  for (const name of CONTRACT_NAMES) {
    const c = d.contracts[name];
    if (!c) throw new Error(`deployment record missing contract: ${name}`);
    if (!/^C[A-Z2-7]{55}$/.test(c.contract_id ?? "")) {
      throw new Error(`${name}: invalid contract id ${c.contract_id}`);
    }
    if (!/^[0-9a-f]{64}$/.test(c.deploy_tx ?? "")) {
      throw new Error(`${name}: invalid deploy_tx ${c.deploy_tx}`);
    }
    if (!/^[0-9a-f]{64}$/.test(c.wasm_sha256 ?? "")) {
      throw new Error(`${name}: invalid wasm_sha256 ${c.wasm_sha256}`);
    }
    if (!c.version) throw new Error(`${name}: missing version`);
  }
  return d as DeploymentRecord;
}

/** Stellar Explorer links (testnet) derived from network + ids — never hardcoded elsewhere. */
export function explorerLinks(record: DeploymentRecord) {
  const net = record.network;
  const base = `https://stellar.expert/explorer/${net}`;
  return {
    contracts: Object.fromEntries(
      Object.entries(record.contracts).map(([name, c]) => [
        name,
        `${base}/contract/${c.contract_id}`,
      ]),
    ) as Record<string, string>,
    tx: (hash: string) => `${base}/tx/${hash}`,
  };
}
