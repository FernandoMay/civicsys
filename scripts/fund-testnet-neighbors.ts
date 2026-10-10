#!/usr/bin/env node
/**
 * Brújula Cívica — fund real Stellar **testnet** neighbor accounts.
 *
 * Purpose (roadmap: "Fund 4 real testnet neighbor accounts"):
 *   create (if needed) and fund 4 independent testnet identities that can act
 *   as citizens/voters in later end-to-end runs, and write verifiable funding
 *   evidence to deployments/testnet-neighbors.json.
 *
 * Honesty rules:
 *   - evidence records PUBLIC addresses + balances observed on Horizon only;
 *     seed phrases stay in the local `stellar keys` keystore and NEVER enter
 *     the repo or the evidence file;
 *   - an account is only recorded as funded after Horizon (not the CLI's own
 *     exit code) shows >= MIN_BALANCE_XLM on-chain;
 *   - exits non-zero if any of the 4 accounts cannot be funded/verified.
 *
 * Usage:  node scripts/fund-testnet-neighbors.ts
 * Idempotent: already-funded neighbors are only re-measured, not re-funded
 * (keeps within friendbot rate limits).
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "deployments", "testnet-neighbors.json");
const HORIZON = "https://horizon-testnet.stellar.org";

/** The four neighbor identities (names local to this machine's keystore). */
const NEIGHBORS = [
  "brujula-neighbor-1",
  "brujula-neighbor-2",
  "brujula-neighbor-3",
  "brujula-neighbor-4",
];

/** friendbot funds fresh accounts with 10 000 XLM; require a solid floor. */
const MIN_BALANCE_XLM = 1000;
const FUND_ATTEMPTS = 5;
const FUND_BACKOFF_MS = 12_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** Run the Stellar CLI; returns trimmed stdout. Throws on non-zero exit. */
function stellar(args: string[]): string {
  return execFileSync("stellar", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryStellar(args: string[]): string | null {
  try {
    return stellar(args);
  } catch {
    return null;
  }
}

/** Public address of a keystore identity, or null if it does not exist. */
function addressOf(name: string): string | null {
  const out = tryStellar(["keys", "address", name]);
  return out && /^G[A-Z2-7]{55}$/.test(out) ? out : null;
}

/** On-chain XLM balance from Horizon; null when the account does not exist. */
async function balanceOf(address: string): Promise<number | null> {
  const res = await fetch(`${HORIZON}/accounts/${address}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Horizon ${res.status} for ${address}`);
  const body = (await res.json()) as {
    balances?: { asset_type: string; balance: string }[];
  };
  const native = body.balances?.find((b) => b.asset_type === "native");
  return native ? Number(native.balance) : null;
}

/** Ask friendbot to fund, with backoff for its rate limit. */
async function friendbot(name: string): Promise<void> {
  let lastErr = "friendbot never ran";
  for (let attempt = 1; attempt <= FUND_ATTEMPTS; attempt++) {
    // tryStellar: null = CLI failure, string (maybe empty) = success
    const out = tryStellar(["keys", "fund", name, "--network", "testnet"]);
    if (out !== null) return;
    lastErr = `friendbot attempt ${attempt}/${FUND_ATTEMPTS} failed`;
    console.error(`  ! ${lastErr} — backing off ${FUND_BACKOFF_MS / 1000}s`);
    if (attempt < FUND_ATTEMPTS) await sleep(FUND_BACKOFF_MS);
  }
  throw new Error(lastErr);
}

interface Evidence {
  name: string;
  address: string;
  balance_xlm: number;
  funded_at: string;
  fund_source: "friendbot" | "already-funded";
}

async function ensureFunded(name: string): Promise<Evidence> {
  let address = addressOf(name);
  if (address === null) {
    console.log(`· ${name}: not in keystore — generating (testnet)`);
    stellar(["keys", "generate", name, "--network", "testnet"]);
    address = addressOf(name);
    if (address === null) throw new Error(`${name}: generated but no address`);
  } else {
    console.log(`· ${name}: ${address}`);
  }

  let balance = await balanceOf(address);
  let source: Evidence["fund_source"] = "already-funded";

  if (balance !== null && balance >= MIN_BALANCE_XLM) {
    console.log(`  already funded on-chain: ${balance} XLM — skipping friendbot`);
  } else {
    // friendbot only CREATES accounts; an existing-but-low account cannot be
    // topped up by it. Fail fast with the real state instead of retrying.
    if (balance !== null) {
      throw new Error(
        `${name} (${address}) exists on-chain with only ${balance} XLM — ` +
          `friendbot cannot top up existing accounts (manual top-up needed)`,
      );
    }
    source = "friendbot";
    console.log(`  no on-chain account yet — requesting friendbot…`);
    await friendbot(name);
    // friendbot + ledger can lag a beat; poll Horizon before declaring success.
    for (let i = 0; i < 10; i++) {
      balance = await balanceOf(address);
      if (balance !== null && balance >= MIN_BALANCE_XLM) break;
      await sleep(3000);
    }
    if (balance === null || balance < MIN_BALANCE_XLM) {
      throw new Error(
        `${name} (${address}): balance ${balance ?? "absent"} XLM after funding — ` +
          `need >= ${MIN_BALANCE_XLM} (fail-closed: not recording unverified funding)`,
      );
    }
    console.log(`  funded + verified on-chain: ${balance} XLM`);
  }

  return {
    name,
    address,
    balance_xlm: balance,
    funded_at: nowIso(),
    fund_source: source,
  };
}

async function main(): Promise<void> {
  console.log(`Brújula Cívica neighbor funding — Stellar TESTNET (${HORIZON})`);
  console.log(`neighbors: ${NEIGHBORS.join(", ")}\n`);

  const accounts: Evidence[] = [];
  for (const name of NEIGHBORS) {
    accounts.push(await ensureFunded(name));
  }

  const record = {
    schema: "brujula-civica/testnet-neighbors@1",
    network: "testnet",
    horizon: HORIZON,
    generated_at: nowIso(),
    min_balance_xlm: MIN_BALANCE_XLM,
    note: "public addresses only — seed phrases live in the local stellar keys keystore and are never written here",
    accounts,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(record, null, 2) + "\n");

  console.log(`\nevidence written: ${OUT}`);
  for (const a of accounts) {
    console.log(
      `  ${a.name.padEnd(20)} ${a.address}  ${a.balance_xlm} XLM (${a.fund_source})`,
    );
  }
  if (accounts.length !== NEIGHBORS.length) {
    throw new Error(`expected ${NEIGHBORS.length} accounts, got ${accounts.length}`);
  }
  console.log(`\nFUNDING PASSED — ${accounts.length}/${NEIGHBORS.length} neighbors funded and verified on-chain.`);
}

main().catch((err) => {
  console.error(`\nFUNDING FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
