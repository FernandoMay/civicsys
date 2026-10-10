/**
 * Deterministic claim verification.
 *
 * RFC §6: every claim carries sources, a retrieval timestamp, content hashes,
 * a verification rule id and a status from a fixed vocabulary. There is no model
 * here and none is needed — a rule is a pure function of the evidence set, so
 * the same sources always yield the same verdict, on any machine, forever.
 *
 * Status semantics, and why each is honest:
 *
 *   SUPPORTED    — at least `minSources` independently retrieved sources contain
 *                  the claim string. We say "these sources say this", never
 *                  "this is true".
 *   CONTRADICTED — the sources were retrievable and none of them contains the
 *                  claim. The claim is contradicted *by the sources*, which is
 *                  a statement about the sources, not about the world.
 *   UNVERIFIED   — not enough of the evidence set could be retrieved to decide.
 *                  This is the fail-closed branch: an unreachable source must
 *                  never be silently read as absence of evidence.
 */

import type { ClaimFinding, ClaimRule, ClaimStatus, EvidenceSet } from "./types.js";

const ZERO_WIDTH_OR_SPACE = /[‌‍﻿\t ]/g;

/**
 * Fold a string for matching without changing what it means.
 *
 * Sources differ in line endings, non-breaking spaces and soft hyphens. Those
 * are typographic noise, not evidence, so they must not decide a verdict.
 */
function normalize(text: string): string {
  return text.normalize("NFC").replace(ZERO_WIDTH_OR_SPACE, " ");
}

export function evaluateClaim(evidence: EvidenceSet, rule: ClaimRule): ClaimFinding {
  const wanted = normalize(rule.claim);
  if (wanted.length === 0) {
    throw new Error(`regla ${rule.id}: el texto de la afirmación está vacío`);
  }
  const minSources = Math.max(1, rule.minSources ?? 1);

  const matched: number[] = [];
  let retrieved = 0;

  for (const [i, source] of evidence.sources.entries()) {
    if (source.status !== "RETRIEVED" || source.text === null) continue;
    retrieved += 1;
    if (normalize(source.text).includes(wanted)) matched.push(i);
  }

  const detailBase =
    `${matched.length} fuente(s) contienen la afirmación de ` +
    `${retrieved} fuente(s) recuperada(s); se requieren ${minSources}`;

  let status: ClaimStatus;
  let detail: string;

  if (retrieved === 0) {
    status = "UNVERIFIED";
    detail = `ninguna fuente pudo recuperarse, no hay base para decidir. ${detailBase}`;
  } else if (matched.length >= minSources) {
    status = "SUPPORTED";
    detail =
      `las fuentes ${formatIndices(matched)} contienen el texto esperado. ${detailBase}`;
  } else if (retrieved >= minSources) {
    status = "CONTRADICTED";
    detail =
      `las fuentes recuperadas ${formatIndices(range(retrieved))} no contienen el texto ` +
      `esperado. ${detailBase}`;
  } else {
    // Fewer sources were retrievable than the rule demands: we did not gather
    // enough evidence to support OR to contradict.
    status = "UNVERIFIED";
    detail =
      `solo ${retrieved} fuente(s) recuperada(s) y se requieren ${minSources}: ` +
      `insuficiente para apoyar ni para contradecir. ${detailBase}`;
  }

  return {
    claim: rule.claim,
    status,
    ruleId: rule.id,
    ruleDescription: rule.description,
    matchedSourceIndices: matched,
    retrievedSourceCount: retrieved,
    detail,
  };
}

/** Worst status wins: a single CONTRADICTED finding cannot be diluted away. */
const SEVERITY: Record<ClaimStatus, number> = {
  SUPPORTED: 0,
  UNKNOWN: 1,
  UNVERIFIED: 2,
  CONTRADICTED: 3,
};

export function rollUpStatus(findings: readonly ClaimFinding[]): ClaimStatus {
  if (findings.length === 0) return "UNKNOWN";
  return findings.reduce<ClaimStatus>(
    (worst, f) => (SEVERITY[f.status] > SEVERITY[worst] ? f.status : worst),
    "SUPPORTED",
  );
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

function formatIndices(indices: readonly number[]): string {
  return indices.length === 0 ? "(ninguna)" : `[${indices.join(", ")}]`;
}