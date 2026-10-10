/**
 * Admin signer management (RFC BRUJULA-CIVICA-ARCH-001 §7, threat T8).
 *
 * The four contracts take an N-of-N signer set: every signer must authorise
 * every privileged call. `stellar contract invoke` cannot express that — it
 * signs with the source account plus at most one extra key — so operating a
 * multi-signer contract needs a transaction assembled with one authorisation
 * per signer. That is what this script does, via the SDK's `signAuthEntry`,
 * which routes each auth entry to the key that owns it.
 *
 * Secrets are read from the local `stellar keys` keystore at call time and are
 * never written to disk, logged, or committed.
 *
 * Usage:
 *   node --experimental-strip-types scripts/admin-signers.ts <command> [options]
 *
 * Commands:
 *   show                        print the current signer set and pending rotation
 *   set --signers a,b,c          replace the signer set (all current signers must sign)
 *   schedule --to G…             schedule a rotation, effective after the delay
 *   cancel                      cancel a scheduled rotation
 *   execute                     apply a scheduled rotation once the delay elapsed
 *
 * Options:
 *   --contract brujula-identity  which contract (default brujula-identity)
 *   --keys alias1,alias2        keystore aliases of the CURRENT signers
 *   --new-keys a,b               keystore aliases of the NEW signers (set only)
 *
 * Example (2-of-2 rotation, keys in the local keystore):
 *   node --experimental-strip-types scripts/admin-signers.ts show \
 *     --contract brujula-identity --keys brujula-deployer,brujula-admin-2
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Address, rpc } from "@stellar/stellar-sdk";
import { Keypair } from "@stellar/stellar-sdk";
import { Client, KeypairSigner } from "@stellar/stellar-sdk/contract";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONTRACT = "brujula-identity";
const DEFAULT_RPC = process.env["BRUJULA_CIVICA_RPC_URL"] ?? "https://soroban-testnet.stellar.org";

interface Record_ {
  network: string;
  network_passphrase: string;
  contracts: Record<string, { contract_id: string; wasm_sha256: string }>;
}

const record = JSON.parse(
  readFileSync(join(ROOT, "deployments", "testnet.json"), "utf8"),
) as Record_;

function die(msg: string): never {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Resolve keystore aliases to keypairs. Secrets never leave this function. */
function loadKeys(aliases: string[]): Keypair[] {
  return aliases.map((alias) => {
    const res = spawnSync("stellar", ["keys", "secret", alias], { encoding: "utf8" });
    if (res.status !== 0) {
      die(`no se pudo leer la clave del alias "${alias}": ${(res.stderr ?? "").trim()}`);
    }
    try {
      return Keypair.fromSecret((res.stdout ?? "").trim());
    } catch {
      die(`el alias "${alias}" no contiene una clave válida`);
    }
  });
}

/**
 * Build a client whose auth entries are signed by whichever key owns them.
 *
 * `publicKey` is the source account that pays fees and signs the envelope;
 * `signAuthEntry` supplies the per-signer authorisation each N-of-N contract
 * entrypoint requires.
 */
async function clientFor(contractName: string, keys: Keypair[]) {
  const c = record.contracts[contractName];
  if (!c) die(`deployments/testnet.json no contiene ${contractName}`);
  return Client.fromWasmHash(
    c.wasm_sha256,
    {
      contractId: c.contract_id,
      networkPassphrase: record.network_passphrase,
      rpcUrl: DEFAULT_RPC,
      publicKey: keys[0]!.publicKey(),
      signTransaction: async (xdr: string) => {
        keys[0]!.signTransaction(xdr, record.network_passphrase);
        return xdr;
      },
      signAuthEntry: async (entryXdr: string, address: string) => {
        const owner = keys.find((k) => k.publicKey() === address);
        if (!owner) {
          throw new Error(
            `ninguna clave proporcionada corresponde a ${address}; ` +
              `pasa todos los firmantes actuales con --keys`,
          );
        }
        owner.signAuthEntry(entryXdr, record.network_passphrase);
        return entryXdr;
      },
    },
    "hex",
  );
}

/**
 * Submit an N-of-N call.
 *
 * The flow is: build + simulate (which records one auth entry per signer),
 * sign each auth entry with the key that owns it, then sign and send the
 * envelope. `signAndSend` on its own only handles the source account, which is
 * exactly why `stellar contract invoke` cannot drive a multi-signer contract.
 */
async function submitMulti(assembled: any, keys: Keypair[]) {
  // The source account signs the transaction envelope, not an auth entry, so
  // asking it to sign auth entries fails. Only the *other* signers produce
  // address-credential auth entries.
  const source = keys[0]!.publicKey();
  for (const k of keys.slice(1)) {
    await assembled.signAuthEntries({
      signAuthEntry: new KeypairSigner(k, record.network_passphrase),
      address: k.publicKey(),
    });
  }
  const missing = await assembled.needsNonInvokerSigningBy();
  if (missing.length > 0) {
    die(
      `faltan firmas de: ${missing.join(", ")}. ` +
        `Pasa todos los firmantes actuales con --keys (la fuente va primero).`,
    );
  }
  return assembled.signAndSend({
    signTransaction: new KeypairSigner(keys[0]!, record.network_passphrase),
  });
}

function aliases(list: string | undefined): string[] {
  if (!list) die("falta --keys con los alias del keystore de los firmantes actuales");
  const a = list.split(",").map((s) => s.trim()).filter(Boolean);
  if (a.length === 0) die("--keys no contiene ningún alias");
  return a;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const contractName = arg("contract") ?? DEFAULT_CONTRACT;
  const current = aliases(arg("keys"));
  const keys = loadKeys(current);
  const contractId = record.contracts[contractName]?.contract_id;
  if (!contractId) die(`deployments/testnet.json no contiene ${contractName}`);

  console.log(`contrato: ${contractName} (${contractId})`);
  console.log(`firmantes: ${keys.map((k) => k.publicKey()).join(", ")}\n`);

  // Reads go through `queryContract`, which returns decoded values. The typed
  // Client returns the raw simulation envelope instead.
  const server = new rpc.Server(DEFAULT_RPC);
  const read = async (method: string) => {
    const { result } = await server.queryContract(contractId, method, {});
    const raw = result as unknown;
    // `queryContract` normally returns `{ retval }`; be defensive about shapes
    // so a primitive return value is never mistaken for an envelope.
    if (typeof raw === "object" && raw !== null && "retval" in raw) {
      return (raw as { retval: unknown }).retval;
    }
    return raw;
  };

  if (command === "show") {
    const signers = await read("admin_signers");
    const pending = await read("pending_admin_rotation");
    const delay = await read("admin_rotation_delay");
    // `pending_admin_rotation` carries a u64 ledger timestamp, which is a BigInt
    // after decoding and cannot go through JSON.stringify directly.
    const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
    console.log(`admin_signers:          ${j(signers)}`);
    console.log(`pending_admin_rotation: ${j(pending)}`);
    console.log(`admin_rotation_delay:   ${j(delay)} segundos`);
    return;
  }

  const client = await clientFor(contractName, keys);

  if (!has("send")) {
    console.log("(simulación; añade --send para enviar la transacción)");
  }

  switch (command) {
    case "set": {
      const nextAliases = aliases(arg("new-keys"));
      const next = loadKeys(nextAliases);
      const addresses = next.map((k) => k.publicKey());
      console.log(`nuevo conjunto: ${addresses.join(", ")}`);
      // Untyped `Client` methods take a *named* args object, and a plain string
      // array does not serialise to a Soroban `Vec<Address>`; wrapping each
      // entry in `Address` makes the SDK emit an ScVal address.
      const assembled = await client.set_signers({
        new_signers: addresses.map((a) => new Address(a)),
      });
      if (has("send")) {
        const sent = await submitMulti(assembled, keys);
        console.log(`tx: ${sent.sendTransactionResponse?.hash ?? "UNKNOWN"}`);
      } else {
        console.log("simulado correctamente (todos los firmantes autorizaron)");
      }
      return;
    }
    case "schedule": {
      const to = arg("to");
      if (!to) die("falta --to con la dirección del nuevo firmante");
      const assembled = await client.schedule_admin_rotation({ new_admin: to });
      if (has("send")) {
        const sent = await submitMulti(assembled, keys);
        console.log(`tx: ${sent.sendTransactionResponse?.hash ?? "UNKNOWN"}`);
      } else {
        console.log("simulado: la rotación quedó programada");
      }
      return;
    }
    case "cancel": {
      const assembled = await client.cancel_admin_rotation();
      if (has("send")) {
        const sent = await submitMulti(assembled, keys);
        console.log(`tx: ${sent.sendTransactionResponse?.hash ?? "UNKNOWN"}`);
      } else {
        console.log("simulado: cancelación válida");
      }
      return;
    }
    case "execute": {
      const assembled = await client.execute_admin_rotation();
      if (has("send")) {
        const sent = await submitMulti(assembled, keys);
        console.log(`tx: ${sent.sendTransactionResponse?.hash ?? "UNKNOWN"}`);
      } else {
        console.log("simulado: la rotación es ejecutable");
      }
      return;
    }
    default:
      die(`comando desconocido "${command ?? ""}" (usa show|set|schedule|cancel|execute)`);
  }
}

main().catch((e: unknown) => die(e instanceof Error ? e.message : String(e)));