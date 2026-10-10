/**
 * Report hashing and reproducibility.
 *
 * The central property: the same evidence set must always produce the same
 * `evidenceHash` and `reportHash`, regardless of key insertion order, wall
 * clock, or how many times you run it. If that fails, the on-chain anchor is
 * meaningless.
 */

import { describe, expect, it } from "vitest";

import { buildReport, evidenceHash } from "../src/report.js";
import type { ClaimRule, EvidenceSet, RetrievedSource } from "../src/types.js";

function source(over: Partial<RetrievedSource> = {}): RetrievedSource {
  return {
    url: "https://example.org/doc",
    finalUrl: "https://example.org/doc",
    status: "RETRIEVED",
    httpStatus: 200,
    retrievedAt: "2026-10-10T00:00:00.000Z",
    contentHash: "a".repeat(64),
    text: "El presupuesto aprobado es de 4200000 USD.",
    contentType: "text/plain",
    byteLength: 41,
    error: null,
    ...over,
  };
}

const RULE: ClaimRule = {
  id: "budget",
  description: "presupuesto en la fuente",
  claim: "4200000 USD",
};

function evidence(sources: RetrievedSource[]): EvidenceSet {
  return { subject: "propuesta-1", sources };
}

describe("evidenceHash", () => {
  it("is stable across repeated calls", async () => {
    const e = evidence([source()]);
    const a = await evidenceHash(e);
    const b = await evidenceHash(e);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not depend on source property insertion order", async () => {
    const a = await evidenceHash(evidence([source()]));
    const reordered: RetrievedSource = {
      error: null,
      byteLength: 41,
      contentType: "text/plain",
      text: "El presupuesto aprobado es de 4200000 USD.",
      contentHash: "a".repeat(64),
      retrievedAt: "2026-10-10T00:00:00.000Z",
      httpStatus: 200,
      status: "RETRIEVED",
      finalUrl: "https://example.org/doc",
      url: "https://example.org/doc",
    };
    expect(await evidenceHash(evidence([reordered]))).toBe(a);
  });

  it("changes when the content changes", async () => {
    const a = await evidenceHash(evidence([source()]));
    const b = await evidenceHash(evidence([source({ text: "otro texto" })]));
    expect(a).not.toBe(b);
  });

  it("changes when the content hash is tampered with", async () => {
    const a = await evidenceHash(evidence([source()]));
    const b = await evidenceHash(evidence([source({ contentHash: "b".repeat(64) })]));
    expect(a).not.toBe(b);
  });

  it("changes when a source is added or removed", async () => {
    const one = await evidenceHash(evidence([source()]));
    const two = await evidenceHash(evidence([source(), source({ url: "https://x/2" })]));
    expect(one).not.toBe(two);
  });

  it("changes when a retrieval outcome changes", async () => {
    const ok = await evidenceHash(evidence([source()]));
    const failed = await evidenceHash(
      evidence([source({ status: "HTTP_ERROR", httpStatus: 500, text: null, contentHash: null })]),
    );
    expect(ok).not.toBe(failed);
  });

  // These fields differ between two fetches of identical bytes. If they were
  // hashed, a third party could never reproduce the anchor.
  it("ignores retrievedAt, httpStatus, finalUrl and error", async () => {
    const base = await evidenceHash(evidence([source()]));
    const later = await evidenceHash(
      evidence([
        source({
          retrievedAt: "2031-01-01T00:00:00.000Z",
          httpStatus: 203,
          finalUrl: "https://cdn.example.org/mirrored/doc",
          error: null,
        }),
      ]),
    );
    expect(later).toBe(base);
  });

  it("still distinguishes a redirect target change only via the requested url", async () => {
    const a = await evidenceHash(evidence([source()]));
    const b = await evidenceHash(evidence([source({ url: "https://example.org/other" })]));
    expect(a).not.toBe(b);
  });
});

describe("buildReport", () => {
  it("reproduces both digests across runs and clocks", async () => {
    const e = evidence([source()]);
    const at = new Date("2020-01-01T00:00:00Z");
    const later = new Date("2030-06-06T06:06:06Z");
    const a = await buildReport(e, [RULE], { generatedAt: at });
    const b = await buildReport(e, [RULE], { generatedAt: later });
    expect(a.evidenceHash).toBe(b.evidenceHash);
    expect(a.reportHash).toBe(b.reportHash);
    // `generatedAt` is display metadata and is deliberately not hashed.
    expect(a.generatedAt).not.toBe(b.generatedAt);
  });

  it("returns SUPPORTED when the source contains the claim", async () => {
    const r = await buildReport(evidence([source()]), [RULE]);
    expect(r.overallStatus).toBe("SUPPORTED");
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.ruleId).toBe("budget");
    expect(r.failedSourceCount).toBe(0);
  });

  it("counts failed sources instead of hiding them", async () => {
    const r = await buildReport(
      evidence([
        source(),
        source({ status: "HTTP_ERROR", httpStatus: 404, text: null, contentHash: null, error: "HTTP 404" }),
      ]),
      [RULE],
    );
    expect(r.failedSourceCount).toBe(1);
    expect(r.overallStatus).toBe("SUPPORTED"); // the good source still corroborates
  });

  it("is UNKNOWN when there are no rules at all", async () => {
    const r = await buildReport(evidence([source()]), []);
    expect(r.overallStatus).toBe("UNKNOWN");
    expect(r.findings).toEqual([]);
  });

  it("refuses duplicate rule ids, since findings must be uniquely identified", async () => {
    await expect(buildReport(evidence([source()]), [RULE, { ...RULE }])).rejects.toThrow(
      /duplicada/,
    );
  });

  it("carries a rule id and description on every finding", async () => {
    const r = await buildReport(evidence([source()]), [
      RULE,
      { ...RULE, id: "second", claim: "texto ausente" },
    ]);
    expect(r.findings.map((f) => f.ruleId)).toEqual(["budget", "second"]);
    expect(r.findings.every((f) => f.ruleDescription.length > 0)).toBe(true);
    expect(r.findings.every((f) => f.detail.length > 0)).toBe(true);
  });
});