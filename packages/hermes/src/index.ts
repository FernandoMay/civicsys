/**
 * Hermes — deterministic evidence verification.
 *
 * Not an AI system and not a language model. Given a set of retrieved sources
 * and a set of explicit rules, it produces the same report every time, on every
 * machine. That is the entire point: RFC BRUJULA-CIVICA-ARCH-001 §0.3 forbids
 * presenting model output as verification, so verification here means
 * reproducible computation over content-addressed evidence.
 */

export * from "./types.js";
export * from "./canonical.js";
export * from "./retrieve.js";
export * from "./rules.js";
export * from "./report.js";

import { retrieveSources, type RetrieveOptions } from "./retrieve.js";
import { buildReport, type BuildReportOptions } from "./report.js";
import type { ClaimRule, EvidenceSet, HermesReport } from "./types.js";

export interface RunOptions extends RetrieveOptions, BuildReportOptions {
  concurrency?: number;
}

/**
 * End-to-end: retrieve the sources, evaluate the rules, return the report.
 *
 * A retrieval failure never aborts the run — it is recorded and degrades the
 * dependent claims to UNVERIFIED, which is the fail-closed outcome.
 */
export async function runHermes(
  subject: string,
  urls: readonly string[],
  rules: readonly ClaimRule[],
  opts: RunOptions = {},
): Promise<{ evidence: EvidenceSet; report: HermesReport }> {
  const { concurrency = 3, ...rest } = opts;
  const sources = await retrieveSources(urls, { ...rest, concurrency });
  const evidence: EvidenceSet = { subject, sources };
  const report = await buildReport(evidence, rules, rest);
  return { evidence, report };
}