import { describe, expect, it } from "vitest";
import { parseDeployment, explorerLinks } from "../src/config.js";

const good = {
  schema: "civicsys/deployments@1",
  network: "testnet",
  network_passphrase: "Test SDF Network ; September 2015",
  source_account: "G" + "A".repeat(55),
  generated_at: "2026-10-08T00:00:00Z",
  contracts: Object.fromEntries(
    ["civic-identity", "civic-proposal", "civic-vote", "civic-accountability"].map((n) => [
      n,
      {
        version: "0.1.0",
        contract_id: "C" + "B".repeat(55),
        deploy_tx: "a".repeat(64),
        deploy_ledger: "123",
        wasm_sha256: "b".repeat(64),
      },
    ]),
  ),
};

describe("parseDeployment", () => {
  it("accepts a well-formed record", () => {
    const d = parseDeployment(good);
    expect(d.network).toBe("testnet");
    expect(Object.keys(d.contracts)).toHaveLength(4);
  });

  it("rejects a missing contract (fail-closed)", () => {
    const bad = structuredClone(good);
    delete (bad.contracts as Record<string, unknown>)["civic-vote"];
    expect(() => parseDeployment(bad)).toThrow(/missing contract: civic-vote/);
  });

  it("rejects a non-hash deploy_tx (no fake deployment claims)", () => {
    const bad = structuredClone(good);
    (bad.contracts as Record<string, Record<string, unknown>>)["civic-identity"]!.deploy_tx =
      "not-a-hash";
    expect(() => parseDeployment(bad)).toThrow(/invalid deploy_tx/);
  });

  it("rejects a non-contract id", () => {
    const bad = structuredClone(good);
    (bad.contracts as Record<string, Record<string, unknown>>)["civic-identity"]!.contract_id =
      "G" + "A".repeat(55);
    expect(() => parseDeployment(bad)).toThrow(/invalid contract id/);
  });

  it("rejects a missing source hash", () => {
    const bad = structuredClone(good);
    (bad.contracts as Record<string, Record<string, unknown>>)["civic-identity"]!.wasm_sha256 =
      "";
    expect(() => parseDeployment(bad)).toThrow(/invalid wasm_sha256/);
  });
});

describe("explorerLinks", () => {
  it("derives links from network + ids", () => {
    const links = explorerLinks(good as never);
    expect(links.contracts["civic-vote"]).toContain("/explorer/testnet/contract/C");
    expect(links.tx("cd".repeat(32))).toContain("/tx/");
  });
});
