/**
 * Hermes CLI — run the deterministic evidence engine and (optionally) anchor
 * the resulting report in `BrujulaAccountability`.
 *
 * This is the executable form of RFC BRUJULA-CIVICA-ARCH-001 §6:
 *
 *   retrieval → evidence set → claim extraction → verification → report
 *     → evidence_hash = H(canonical JSON of the evidence set)
 *     → anchor(report_hash, evidence_hash)
 *
 * There is no model in this pipeline. Re-running it against unchanged sources
 * reproduces both digests exactly, which is what makes the anchor worth having.
 *
 * Usage:
 *   node --experimental-strip-types scripts/hermes-run.ts [options]
 *
 *   --config <path>     hermes config JSON (default ./hermes.config.json)
 *   --out <path>        evidence output (default deployments/hermes/<ts>.json)
 *   --anchor            submit the report to brujula-accountability
 *   --account <key>     Stellar identity to sign with (env BRUJULA_CIVICA_DEPLOYER)
 *   --dry-run           evaluate and write evidence without touching the chain
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runHermes } from "@brugulacivica/hermes";
import type { ClaimRule, HermesReport, RetrievedSource } from "@brugulacivica/hermes";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOYMENT_FILE = join(ROOT, "deployments", "testnet.json");

interface HermesConfig {
  subject: string;
  sources: string[];
  rules: ClaimRule[];
}

interface Args {
  config: string;
  out: string | null;
  anchor: boolean;
  account: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  return {
    config: resolve(ROOT, get("--config") ?? "hermes.config.json"),
    out: get("--out") ?? null,
    anchor: argv.includes("--anchor"),
    account: get("--account") ?? process.env["BRUJULA_CIVICA_DEPLOYER"] ?? "brujula-deployer",
    dryRun: !argv.includes("--anchor"),
  };
}

function loadConfig(path: string): HermesConfig {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<HermesConfig>;
  if (typeof raw.subject !== "string" || raw.subject.length === 0) {
    throw new Error(`config invalido: falta "subject" en ${path}`);
  }
  if (!Array.isArray(raw.sources) || raw.sources.length === 0) {
    throw new Error(`config invalido: "sources" debe ser un array no vacio en ${path}`);
  }
  if (!Array.isArray(raw.rules) || raw.rules.length === 0) {
    // A rule set with no claims would produce UNKNOWN and an anchor with no
    // content, which is worse than refusing to run.
    throw new Error(`config invalido: "rules" debe ser un array no vacio en ${path}`);
  }
  const ids = new Set<string>();
  for (const r of raw.rules) {
    if (!r.id || !r.claim || !r.description) {
      throw new Error(`regla invalida en ${path}: id, description y claim son obligatorios`);
    }
    if (ids.has(r.id)) throw new Error(`regla duplicada en ${path}: ${r.id}`);
    ids.add(r.id);
  }
  return raw as HermesConfig;
}

/** What is written to disk: digests and provenance, plus the full evidence. */
interface HermesEvidenceFile {
  schema: string;
  generated_at: string;
  subject: string;
  config: string;
  network: string;
  contract_id: string | null;
  anchor_tx: string | null;
  report_id: string | null;
  report_hash: string;
  evidence_hash: string;
  overall_status: string;
  failed_source_count: number;
  findings: HermesReport["findings"];
  sources: Omit<RetrievedSource, "text">[] & { text_bytes: number };
  report_text_omitted: true;
}

function summarize(source: RetrievedSource) {
  const { text, ...rest } = source;
  return { ...rest, text_bytes: text === null ? 0 : new TextEncoder().encode(text).length };
}

function contractId(): string {
  const record = JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf8")) as {
    contracts: Record<string, { contract_id: string }>;
  };
  const id = record.contracts["brujula-accountability"]?.contract_id;
  if (!id) throw new Error("deployments/testnet.json no contiene brujula-accountability");
  return id;
}

/**
 * Anchor via the Stellar CLI, exactly like scripts/smoke-test.sh.
 *
 * Using the CLI (rather than an in-process signer) keeps a single code path for
 * how transactions get submitted and signed, and avoids putting a private key
 * anywhere near this repository.
 */
function anchor(args: Args, report: HermesReport): { reportId: string; txHash: string | null } {
  const cid = contractId();
  // The CLI prints the contract id on stdout but the "Signing transaction: <hash>"
  // line on stderr, so both streams must be inspected to recover the tx hash.
  const proc = spawnSync(
    "stellar",
    [
      "contract", "invoke",
      "--id", cid,
      "--source-account", args.account,
      "--network", "testnet",
      "--very-verbose",
      "--",
      "anchor",
      "--proposal_id", process.env["HERMES_PROPOSAL_ID"] ?? "1",
      "--report_hash", report.reportHash,
      "--evidence_hash", report.evidenceHash,
      "--kind", "hermes",
      "--author", stellarAddress(args.account),
    ],
    { encoding: "utf8" },
  );
  const combined = `${proc.stdout ?? ""}\n${proc.stderr ?? ""}`;

  if (proc.status !== 0) {
    throw new Error(
      `stellar contract invoke falló (exit ${proc.status}): ${combined.split("\n").slice(-8).join("\n")}`,
    );
  }

  const reportId = (proc.stdout ?? "").replace(/[^0-9]/g, "");
  if (!reportId) {
    throw new Error(`no se pudo leer el report_id de la salida: ${combined.slice(0, 300)}`);
  }

  // No capture group in this pattern, so the full match is index 0.
  const TX_RE = /[0-9a-f]{64}/;
  const signedLines = combined
    .split("\n")
    .filter((l) => l.includes("Signing transaction:"));
  const txHash =
    signedLines.length === 0 ? null : TX_RE.exec(signedLines[signedLines.length - 1]!)?.[0];
  if (!txHash) {
    throw new Error(
      "la transacción se envió pero no se pudo extraer el tx hash; evidencia incompleta",
    );
  }
  return { reportId, txHash };
}

function stellarAddress(key: string): string {
  return execFileSync("stellar", ["keys", "public-key", key], { encoding: "utf8" }).trim();
}

function die(message: string): never {
  console.error(`FATAL: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args.config);

  console.log(`Hermes — ${config.subject}`);
  console.log(`  fuentes: ${config.sources.length}  reglas: ${config.rules.length}`);
  for (const url of config.sources) console.log(`    · ${url}`);

  const { evidence, report } = await runHermes(config.subject, config.sources, config.rules, {
    concurrency: 3,
  });

  console.log("\nRetrieval:");
  for (const s of evidence.sources) {
    const mark = s.status === "RETRIEVED" ? "OK " : "ERR";
    const detail = s.status === "RETRIEVED" ? `sha256=${s.contentHash?.slice(0, 16)}…` : s.error;
    console.log(`  [${mark}] ${s.status.padEnd(16)} ${s.url}`);
    if (detail) console.log(`         ${detail}`);
  }

  console.log("\nVerificación determinista:");
  for (const f of report.findings) {
    console.log(`  ${f.status.padEnd(12)} [${f.ruleId}] ${f.claim.slice(0, 60)}`);
    console.log(`      ${f.detail}`);
  }
  console.log(`\n  estado global: ${report.overallStatus}`);
  console.log(`  report_hash:   ${report.reportHash}`);
  console.log(`  evidence_hash: ${report.evidenceHash}`);

  let reportId: string | null = null;
  let txHash: string | null = null;
  if (args.anchor) {
    console.log("\nAnclaje en brujula-accountability…");
    const anchored = anchor(args, report);
    reportId = anchored.reportId;
    txHash = anchored.txHash;
    console.log(`  report_id: ${reportId}`);
    console.log(`  anchor_tx: ${txHash ?? "UNKNOWN"}`);
  } else {
    console.log("\n(--dry-run: no se envía nada a la cadena; usa --anchor para anclar)");
  }

  const record = JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf8")) as { network: string };
  const file: HermesEvidenceFile = {
    schema: "brujula-civica/hermes-report@1",
    generated_at: report.generatedAt,
    subject: report.subject,
    config: args.config.replace(`${ROOT}/`, ""),
    network: record.network,
    contract_id: args.anchor ? contractId() : null,
    anchor_tx: txHash,
    report_id: reportId,
    report_hash: report.reportHash,
    evidence_hash: report.evidenceHash,
    overall_status: report.overallStatus,
    failed_source_count: report.failedSourceCount,
    findings: report.findings,
    sources: evidence.sources.map(summarize),
    report_text_omitted: true,
  };

  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const outPath = args.out ?? join(ROOT, "deployments", "hermes", `${stamp}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(file, null, 2)}\n`);

  const indexPath = join(ROOT, "deployments", "hermes", "index.json");
  const index = (() => {
    try {
      return JSON.parse(readFileSync(indexPath, "utf8")) as { reports: unknown[] };
    } catch {
      return { reports: [] as unknown[] };
    }
  })();
  index.reports.push({
    generated_at: report.generatedAt,
    // Recorded explicitly: a dry run produces the same digests but NO on-chain
    // anchor, and mixing the two in one list would let an unanchored evaluation
    // be mistaken for evidence.
    anchored: args.anchor,
    report_id: reportId,
    report_hash: report.reportHash,
    evidence_hash: report.evidenceHash,
    overall_status: report.overallStatus,
    anchor_tx: txHash,
  });
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);

  console.log(`\nEvidencia escrita: ${outPath.replace(`${ROOT}/`, "")}`);
  if (!args.anchor) {
    console.log("Nota: sin --anchor esto es una evaluación local, NO evidencia en cadena.");
  }
}

main().catch((e: unknown) => die(e instanceof Error ? e.message : String(e)));