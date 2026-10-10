/**
 * Independent deployment check: is the WASM actually running on chain the one
 * recorded in deployments/testnet.json?
 *
 * `scripts/verify-deployment.sh` compares the record against the *local*
 * artifact. That proves the file on disk matches what we claimed, but not that
 * the network is running it. This script closes that gap by reading the
 * contract instance out of the ledger and comparing all three:
 *
 *     local artifact  <->  recorded evidence  <->  on-chain executable
 *
 * A mismatch anywhere is a hard failure: it would mean the evidence record
 * describes code the network is not running.
 *
 * The on-chain read goes through the Stellar CLI's verbose contract-instance
 * dump rather than a hand-built `LedgerKey` XDR, so it does not depend on the
 * shape of the SDK's generated bindings.
 *
 * Usage: node --experimental-strip-types scripts/verify-onchain-wasm.ts [record]
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RECORD = process.argv[2] ?? join(ROOT, "deployments", "testnet.json");
const NETWORK = process.env["BRUJULA_CIVICA_NETWORK"] ?? "testnet";
const CARGO_TARGET_DIR = process.env["CARGO_TARGET_DIR"] ?? join(ROOT, "target");
const WASM_DIR = join(CARGO_TARGET_DIR, "wasm32v1-none", "release");

interface Record_ {
  network: string;
  contracts: Record<string, { contract_id: string; wasm_sha256: string }>;
}

const record = JSON.parse(readFileSync(RECORD, "utf8")) as Record_;

/**
 * Read the executable hash from the deployed contract instance.
 *
 * Any contract call with `--very-verbose` dumps the instance it is executing,
 * which includes `executable: Wasm(Hash(...))`. `admin()` is used because it is
 * the cheapest entrypoint every contract exposes.
 */
function onChainExecutable(contractId: string): string | null {
  const res = spawnSync(
    "stellar",
    [
      "contract", "invoke",
      "--id", contractId,
      "--source-account", process.env["BRUJULA_CIVICA_DEPLOYER"] ?? "brujula-deployer",
      "--network", NETWORK,
      "--very-verbose",
      "--",
      "admin",
    ],
    { encoding: "utf8" },
  );
  // The contract-instance dump is written to stderr, not stdout.
  const combined = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  const m = /Wasm\(Hash\(([0-9a-f]{64})\)\)/.exec(combined);
  return m?.[1] ?? null;
}

function localSha(path: string): string | null {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

let failures = 0;
const rows: string[] = [];
const short = (h: string | null) => (h ? `${h.slice(0, 16)}…` : "(ausente)");

console.log(`registro: ${RECORD.replace(`${ROOT}/`, "")}`);
console.log(`red:      ${record.network}\n`);

for (const [name, c] of Object.entries(record.contracts)) {
  const local = localSha(join(WASM_DIR, `${name.replace(/-/g, "_")}.wasm`));
  const chain = onChainExecutable(c.contract_id);
  const recorded = c.wasm_sha256;

  const localOk = local === recorded;
  const chainOk = chain === recorded;
  if (!localOk || !chainOk) failures++;

  rows.push(
    `${name}\n` +
      `   artefacto local : ${short(local)}  ${localOk ? "OK" : "NO COINCIDE"}\n` +
      `   evidencia       : ${short(recorded)}\n` +
      `   en cadena       : ${short(chain)}  ${
        chain === null ? "NO LEÍDO" : chainOk ? "OK" : "NO COINCIDE"
      }`,
  );
}

console.log(rows.join("\n\n"));
console.log();

if (failures > 0) {
  console.error(
    `FALLO: ${failures} contrato(s) no coinciden en las tres fuentes.\n` +
      `Si 'artefacto local' falla, ejecuta 'stellar contract build'.`,
  );
  process.exit(1);
}
console.log("OK: artefacto local == evidencia == ejecutable en cadena, para los 4 contratos.");