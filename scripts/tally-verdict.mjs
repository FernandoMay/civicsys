#!/usr/bin/env node
/**
 * CivicSys — compute the REAL verifier verdict for a proposal's on-chain tally.
 *
 * Wraps the SDK (the same pure verifier the dashboard renders): reads the
 * tally from the network named in deployments/testnet.json, runs all checks,
 * and prints JSON for scripts/smoke-test.sh to embed as evidence.
 * Never computes a "verdict" by convention — if the verifier cannot prove
 * consistency, the answer is "unknown" or "mismatch" and the smoke test
 * fails closed.
 *
 * Usage: node scripts/tally-verdict.mjs <proposal_id>
 * Output (stdout): {"status","verdict","vote_count","verification_mode","checks","reason"}
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { loadDeployment } from "../packages/sdk/dist/node.js";
import { CivicReader } from "../packages/sdk/dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const proposalId = process.argv[2];

if (!/^\d+$/.test(proposalId ?? "")) {
  console.error("usage: node scripts/tally-verdict.mjs <proposal_id>");
  process.exit(2);
}
if (!existsSync(join(root, "packages", "sdk", "dist", "index.js"))) {
  console.error("SDK not built — run: pnpm --filter @civicsys/sdk build");
  process.exit(2);
}

const record = loadDeployment(join(root, "deployments", "testnet.json"));
const reader = new CivicReader(record);
const r = await reader.verifyTally(BigInt(proposalId));

const out = {
  status: r.status,
  verdict: r.status === "ok" ? r.value.verdict : "unknown",
  vote_count:
    r.status === "ok" && r.value.tally !== null
      ? Number(r.value.tally.total)
      : null,
  verification_mode: r.status === "ok" ? r.value.mode : null,
  checks: r.status === "ok" ? r.value.checks : [],
  reason: r.status === "unknown" ? r.reason : null,
  evidence: r.evidence ?? null,
};

console.log(
  JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? Number(v) : v)),
);
