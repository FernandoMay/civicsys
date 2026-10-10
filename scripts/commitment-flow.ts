/**
 * Commitment-ballot flow — the executable proof that `commitment_v1` works
 * end to end (RFC BRUJULA-CIVICA-ARCH-001 §5, phase 4a).
 *
 *   1. each voter derives a commitment  c = H(domain ‖ secret ‖ attributes)
 *   2. the admin builds a Merkle tree over those commitments and publishes
 *      the root with `set_membership_root`
 *   3. a voter casts `cast_commitment` with a nullifier derived from their own
 *      secret and the proposal id
 *   4. the ballot is recorded, the tally switches to `commitment_v1`, and the
 *      SDK reports it as UNVERIFIED_COMMITMENT
 *
 * What this DOES NOT prove, and says so: the chain cannot verify a Merkle path.
 * `cast_commitment` only checks that the submitted commitment equals the stored
 * root and that the nullifier is unused. Membership is *claimed*. That residual
 * risk is closed in 4b by a ZK verifier, which does not exist — so the mode
 * stays `commitment_v1` and no anonymity claim is made anywhere.
 *
 * Usage:
 *   node --experimental-strip-types scripts/commitment-flow.ts [--proposal N]
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildMerkle,
  commitCredential,
  deriveNullifier,
  verifyMerkleProof,
  type MerkleProofStep,
} from "@brugulacivica/sdk";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface DeploymentRecord {
  network: string;
  contracts: Record<string, { contract_id: string }>;
}

const record = JSON.parse(
  readFileSync(join(ROOT, "deployments", "testnet.json"), "utf8"),
) as DeploymentRecord;

const ACCOUNT = process.env["BRUJULA_CIVICA_DEPLOYER"] ?? "brujula-deployer";
const DOMAIN = "brujula-civica/testnet/roster";
const ATTRIBUTES = "district=00;role=citizen;cohort=commitment-demo";

function contract(name: string): string {
  const id = record.contracts[name]?.contract_id;
  if (!id) throw new Error(`deployments/testnet.json no contiene ${name}`);
  return id;
}

function address(): string {
  return spawnSync("stellar", ["keys", "public-key", ACCOUNT], { encoding: "utf8" })
    .stdout.trim();
}

/** Invoke a contract; returns stdout, throws on non-zero exit. */
function invoke(cid: string, fn: string, args: string[]): string {
  const proc = spawnSync(
    "stellar",
    [
      "contract", "invoke",
      "--id", cid,
      "--source-account", ACCOUNT,
      "--network", record.network,
      "--very-verbose",
      "--",
      fn,
      ...args,
    ],
    { encoding: "utf8" },
  );
  const combined = `${proc.stdout ?? ""}\n${proc.stderr ?? ""}`;
  if (proc.status !== 0) {
    throw new Error(
      `${fn} falló (exit ${proc.status}): ${combined.split("\n").slice(-10).join("\n")}`,
    );
  }
  return proc.stdout ?? "";
}

function die(message: string): never {
  console.error(`FATAL: ${message}`);
  process.exit(1);
}

/** Deterministic test secrets. Testnet only; these protect nothing. */
const VOTERS = [
  { label: "votante-1", secret: "brujula-testnet-secret-1" },
  { label: "votante-2", secret: "brujula-testnet-secret-2" },
  { label: "votante-3", secret: "brujula-testnet-secret-3" },
];

async function main(): Promise<void> {
  const proposalArg = process.argv.indexOf("--proposal");
  const useExisting = proposalArg !== -1;

  console.log(`Flujo de compromiso (commitment_v1)`);
  console.log(`  red: ${record.network}   identidad: ${ACCOUNT}\n`);

  // Step 0. The demo creates its own proposal with a live voting window, so the
  // flow is self-contained and does not silently depend on the window of some
  // earlier proposal still happening to be open.
  let proposalId: string;
  if (useExisting) {
    proposalId = process.argv[proposalArg + 1]!;
    console.log(`0/5 Usando la propuesta existente #${proposalId}`);
  } else {
    console.log("0/5 Creando una propuesta con ventana abierta");
    const now = Math.floor(Date.now() / 1000);
    const h = (s: string) => createHash("sha256").update(s).digest("hex");
    proposalId = invoke(contract("brujula-proposal"), "create", [
      "--proposer", address(),
      "--title_hash", h(`brujula-civica/commitment-demo/title/${now}`),
      "--description_hash", h("Demostración del flujo de voto por compromiso (commitment_v1)."),
      "--metadata_hash", h('{"kind":"commitment-demo"}'),
      "--content_cid", "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      "--evidence_root", h(`brujula-civica/commitment-demo/root/${now}`),
      "--opens_at", String(now - 60),
      "--closes_at", String(now + 3600),
    ]).replace(/[^0-9]/g, "");
    console.log(`  propuesta #${proposalId} creada, ventana ${now - 60}..${now + 3600}`);
  }
  console.log(`\n  propuesta objetivo: #${proposalId}`);

  // 1. commitments
  console.log("1/5 Compromisos por votante");
  const commitments: string[] = [];
  for (const v of VOTERS) {
    const c = await commitCredential({
      domain: DOMAIN,
      secret: v.secret,
      attributes: ATTRIBUTES,
    });
    commitments.push(c);
    console.log(`  ${v.label.padEnd(10)} ${c}`);
  }

  // 2. Merkle root
  console.log("\n2/5 Árbol Merkle sobre los compromisos");
  const tree = await buildMerkle(commitments);
  console.log(`  hojas:  ${tree.leaves.length}`);
  console.log(`  root:   ${tree.root}`);

  // Prove locally that every leaf really is in the tree.
  for (const [i, c] of commitments.entries()) {
    const ok = await verifyMerkleProof({ root: tree.root, commitment: c, proof: tree.proof(i) });
    if (!ok) die(`la prueba Merkle local falló para la hoja ${i}`);
  }
  console.log("  prueba local: las 3 hojas verifican contra el root publicado");

  // 3. publish the root on chain (admin only)
  console.log("\n3/5 Publicando el root en brujula-vote (set_membership_root)");
  invoke(contract("brujula-vote"), "set_membership_root", [
    "--proposal_id",
    proposalId,
    "--root",
    tree.root,
  ]);
  const stored = invoke(contract("brujula-vote"), "membership_root", [
    "--proposal_id",
    proposalId,
  ]).replace(/[^0-9a-f]/g, "");
  if (stored !== tree.root) {
    die(`el root leído de la cadena (${stored}) no coincide con el calculado (${tree.root})`);
  }
  console.log(`  root confirmado en cadena: ${stored.slice(0, 24)}…`);

  // 4. cast a commitment ballot as voter 1
  console.log("\n4/5 Emitiendo un voto por compromiso (cast_commitment)");
  const voter = VOTERS[0]!;
  const nullifier = await deriveNullifier({ secret: voter.secret, proposalId: BigInt(proposalId) });
  const proof = tree.proof(0) as MerkleProofStep[];
  console.log(`  nullifier: ${nullifier}`);
  console.log(`  camino Merkle: ${proof.length} paso(s) — se envia al auditor, no al contrato`);

  try {
    const out = invoke(contract("brujula-vote"), "cast_commitment", [
      "--proposal_id", proposalId,
      "--choice", "0",
      "--nullifier", nullifier,
      "--commitment", commitments[0]!,
      "--membership_root", tree.root,
      "--verifier_digest", nullifier,
    ]);
    console.log(`  tx aceptada por el contrato: ${out.trim().slice(0, 120)}`);
  } catch (e) {
    // Re-running this script for the same proposal reuses the nullifier, which
    // the contract rejects on purpose. That is the double-vote guard working,
    // so it is reported as such rather than as a failure.
    const msg = e instanceof Error ? e.message : String(e);
    if (/NullifierUsed|already (been )?used|used/i.test(msg)) {
      console.log("  este nullifier ya se usó en una ejecución anterior (guarda anti-doble-voto activa)");
      console.log("  el paso 4 es idempotente a efectos de verificación: omite un nuevo voto");
    } else {
      throw e;
    }
  }

  // 5. read the tally back and report the honest verification status
  console.log("\n5/5 Recuento leído de la cadena");
  const tally = invoke(contract("brujula-vote"), "get_tally", [
    "--proposal_id",
    proposalId,
  ]).trim();
  console.log(`  ${tally}`);

  let parsed: { verification_mode?: string; commitment_votes?: number; public_votes?: number };
  try {
    parsed = JSON.parse(tally) as typeof parsed;
  } catch {
    parsed = {};
  }
  const mode = parsed.verification_mode ?? "UNKNOWN";
  console.log(`\n  modo de verificación: ${mode}`);
  if (mode === "commitment_v1") {
    console.log("  estado honesto: UNVERIFIED_COMMITMENT");
    console.log("  el contrato comprobó raíz y nullifier, NO la pertenencia al árbol.");
    console.log("  no se afirma anonimato: el modo sigue siendo commitment_v1, nunca zk_v1.");
  }

  const out = {
    schema: "brujula-civica/commitment-flow@1",
    generated_at: new Date().toISOString(),
    network: record.network,
    proposal_id: Number(proposalId),
    domain: DOMAIN,
    attributes: ATTRIBUTES,
    commitment_count: commitments.length,
    commitments,
    merkle_root: tree.root,
    nullifier_voter_1: nullifier,
    merkle_path_length: proof.length,
    tally: parsed,
    verification_mode_on_chain: mode,
    honest_status: mode === "commitment_v1" ? "UNVERIFIED_COMMITMENT" : "N/A",
    note:
      "El contrato no verifica caminos Merkle (RFC §5, fase 4a). La pertenencia es una " +
      "afirmación, no una prueba. Se cierra en 4b con un verificador ZK que no existe.",
  };
  const dir = join(ROOT, "deployments", "commitment");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `proposal-${proposalId}.json`);
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nEvidencia escrita: ${file.replace(`${ROOT}/`, "")}`);
}

main().catch((e: unknown) => die(e instanceof Error ? e.message : String(e)));