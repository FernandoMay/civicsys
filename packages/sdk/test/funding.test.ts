/**
 * Funding E2E test — proves the 4 testnet neighbor accounts from
 * deployments/testnet-neighbors.json exist ON-CHAIN with real balances.
 *
 * This is the "ledger state + funding evidence" gate: the evidence file alone
 * is a claim; Horizon is the fact. Fail-closed: missing evidence file,
 * malformed addresses, secret material in the record, or missing/under-funded
 * on-chain accounts all fail the run.
 *
 * Requires network access; run with: pnpm test:funding
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EVIDENCE = join(root, "deployments", "testnet-neighbors.json");

const G_RE = /^G[A-Z2-7]{55}$/;
const ALLOWED_ACCOUNT_KEYS = new Set([
  "name",
  "address",
  "balance_xlm",
  "funded_at",
  "fund_source",
]);

interface NeighborEvidence {
  schema: string;
  network: string;
  horizon: string;
  generated_at: string;
  min_balance_xlm: number;
  accounts: {
    name: string;
    address: string;
    balance_xlm: number;
    funded_at: string;
    fund_source: string;
  }[];
}

function loadEvidence(): NeighborEvidence {
  let raw: string;
  try {
    raw = readFileSync(EVIDENCE, "utf8");
  } catch {
    throw new Error(
      `${EVIDENCE} not found — run scripts/fund-testnet-neighbors.ts first`,
    );
  }
  return JSON.parse(raw) as NeighborEvidence;
}

const show = (v: unknown) => JSON.stringify(v, null, 2);

describe("funding E2E (real testnet neighbor accounts)", () => {
  const ev = loadEvidence();

  it("evidence file is well-formed: schema, 4 addresses, no secrets", () => {
    expect(ev.schema).toBe("brujula-civica/testnet-neighbors@1");
    expect(ev.network).toBe("testnet");
    expect(ev.accounts).toHaveLength(4);
    expect(ev.min_balance_xlm).toBeGreaterThan(0);

    const names = new Set<string>();
    for (const a of ev.accounts) {
      expect(a.address, show(a)).toMatch(G_RE);
      expect(a.name).toMatch(/^brujula-neighbor-[1-4]$/);
      expect(names.has(a.name)).toBe(false);
      names.add(a.name);
      expect(a.balance_xlm).toBeGreaterThanOrEqual(ev.min_balance_xlm);
      expect(Number.isNaN(Date.parse(a.funded_at))).toBe(false);
      expect(["friendbot", "already-funded"]).toContain(a.fund_source);
      // no fields beyond the documented, public-only allowlist
      for (const k of Object.keys(a)) expect(ALLOWED_ACCOUNT_KEYS.has(k)).toBe(true);
    }

    // the record must carry no secret material anywhere (RFC: keys stay local):
    // no property name may suggest key material (prose values like the note's
    // "seed phrases stay local" are fine — keys are what must be absent)
    const forbiddenKeyParts = ["seed", "secret", "mnemonic", "passphrase", "private"];
    const walkKeys = (v: unknown, path: string): string[] => {
      if (v !== null && typeof v === "object") {
        const hits: string[] = [];
        for (const [k, val] of Object.entries(v)) {
          if (forbiddenKeyParts.some((f) => k.toLowerCase().includes(f))) {
            hits.push(`${path}.${k}`);
          }
          hits.push(...walkKeys(val, `${path}.${k}`));
        }
        return hits;
      }
      return [];
    };
    expect(walkKeys(ev, "$"), "secret-looking keys in evidence").toEqual([]);
    // Stellar secret keys are strkeys: 'S' + 55 base32 chars — none may appear
    expect(JSON.stringify(ev)).not.toMatch(/\bS[A-Z2-7]{55}\b/);
  });

  it("every recorded neighbor exists on-chain with >= min XLM (Horizon)", async () => {
    const results: { name: string; onchain_xlm: number | null; status: number }[] = [];

    for (const a of ev.accounts) {
      const res = await fetch(`${ev.horizon}/accounts/${a.address}`);
      let onchain: number | null = null;
      if (res.ok) {
        const body = (await res.json()) as {
          balances?: { asset_type: string; balance: string }[];
        };
        const native = body.balances?.find((b) => b.asset_type === "native");
        onchain = native ? Number(native.balance) : null;
      }
      results.push({ name: a.name, onchain_xlm: onchain, status: res.status });
      expect(res.status, `${a.name} (${a.address}) → HTTP ${res.status}`).toBe(200);
      expect(
        onchain,
        `${a.name} (${a.address}) on-chain ${onchain ?? "absent"} XLM, need >= ${ev.min_balance_xlm}`,
      ).not.toBeNull();
      expect(
        onchain ?? 0,
        `${a.name} (${a.address}) on-chain ${onchain} XLM, need >= ${ev.min_balance_xlm}`,
      ).toBeGreaterThanOrEqual(ev.min_balance_xlm);
    }

    // evidence must agree with reality in kind: all four were observed funded
    expect(results).toHaveLength(4);
    console.log(
      "funding evidence vs Horizon:\n" +
        results
          .map((r) => `  ${r.name.padEnd(20)} HTTP ${r.status}  ${r.onchain_xlm} XLM`)
          .join("\n"),
    );
  }, 60_000);
});
