#!/usr/bin/env node
/**
 * CivicSys — read one subject's credential from the identity contract and
 * print JSON for scripts/smoke-test.sh to assert on (fail-closed: an unreadable
 * credential is reported as not-issued, never assumed).
 *
 * Usage: node scripts/read-credential.mjs <G-address>
 * Output: {"status","issued","commitment","eligible","reason"}
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { loadDeployment } from "../packages/sdk/dist/node.js";
import { CivicReader } from "../packages/sdk/dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const subject = process.argv[2];

if (!/^G[A-Z2-7]{55}$/.test(subject ?? "")) {
  console.error("usage: node scripts/read-credential.mjs <G-address>");
  process.exit(2);
}
if (!existsSync(join(root, "packages", "sdk", "dist", "index.js"))) {
  console.error("SDK not built — run: pnpm --filter @civicsys/sdk build");
  process.exit(2);
}

const record = loadDeployment(join(root, "deployments", "testnet.json"));
const reader = new CivicReader(record);
const r = await reader.getCredential(subject);

const out = {
  status: r.status,
  issued: r.status === "ok" && r.value !== null,
  commitment: r.status === "ok" && r.value !== null ? r.value.commitment : null,
  eligible: r.status === "ok" && r.value !== null ? r.value.eligible : null,
  reason: r.status === "unknown" ? r.reason : null,
};
console.log(JSON.stringify(out));
