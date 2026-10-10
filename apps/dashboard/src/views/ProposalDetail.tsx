/**
 * Proposal detail — one initiative, everything the chain knows about it.
 *
 * Layout follows the second homologated base document (breadcrumb, title block,
 * evidence matrix, scrutiny). Content rules are strict: the chain stores hashes,
 * a CID, a window and a tally — not titles, budgets, contractors, quorums or
 * questions. None of those are rendered, because rendering them would require
 * inventing them.
 */

import { useMemo } from "react";

import { PROPOSAL_STATUS, PROPOSAL_STATUS_LABEL } from "@brugulacivica/sdk";
import type { ProposalRow, ReportEntry } from "../lib/chain.js";
import { dateOrUnknown, shortAddress, shortHash, UNKNOWN } from "../lib/format.js";
import type { Read, VerificationResult } from "@brugulacivica/sdk";

export default function ProposalDetail({
  row,
  reports,
  tally,
  onBack,
  onVote,
}: {
  row: ProposalRow;
  /** Anchored reports filtered to this proposal id. */
  reports: ReportEntry[];
  tally: Read<VerificationResult> | null;
  onBack: () => void;
  onVote: (id: bigint) => void;
}) {
  const { proposal, status } = row;
  const p = proposal.status === "ok" ? proposal.value : null;
  const statusLabel =
    status.status === "ok" ? (PROPOSAL_STATUS_LABEL[status.value] ?? UNKNOWN) : UNKNOWN;
  const isOpen = status.status === "ok" && status.value === PROPOSAL_STATUS.OPEN;

  const counts = useMemo(() => {
    if (tally?.status !== "ok" || !tally.value.tally) return [];
    const t = tally.value.tally;
    return [...t.counts.entries()].map(([choice, n]) => ({
      choice,
      n,
      pct: t.total === 0n ? 0 : (Number((n * 10000n) / t.total) / 100).toFixed(1),
    }));
  }, [tally]);

  const total = tally?.status === "ok" && tally.value.tally ? tally.value.tally.total : null;
  const verdict = tally?.status === "ok" ? tally.value.verdict : "unknown";

  return (
    <div className="flex flex-col w-full pb-space-xl">
      <section className="w-full py-space-md mb-space-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-sm pb-space-sm">
          <nav className="flex items-center gap-space-xs font-code-sm text-code-sm text-outline" aria-label="Miga de pan">
            <button type="button" onClick={onBack} className="hover:text-primary transition-colors">
              INICIATIVAS
            </button>
            <span>/</span>
            <span className="text-on-surface font-semibold">PROPUESTA #{row.id.toString()}</span>
          </nav>
          <div className="flex items-center gap-space-sm flex-wrap">
            <span className="inline-flex items-center px-space-xs py-0.5 bg-surface-container-highest text-on-surface-variant font-code-sm text-code-sm">
              RED STELLAR · TESTNET
            </span>
            <span className="inline-flex items-center px-space-xs py-0.5 bg-surface-container-lowest text-primary font-code-sm text-code-sm font-semibold">
              [{statusLabel}]
            </span>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-space-md pt-space-xs">
          <div className="max-w-4xl">
            <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight">
              Iniciativa #{row.id.toString()}
            </h1>
            <div className="flex flex-wrap items-center gap-x-space-md gap-y-space-xs mt-space-xs font-body-sm text-body-sm text-on-surface-variant">
              <span>
                Proponente:{" "}
                <strong className="text-on-surface font-semibold">
                  {p ? shortAddress(p.proposer) : UNKNOWN}
                </strong>
              </span>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-outline-variant" aria-hidden="true" />
              <span>
                Ventana:{" "}
                <span className="font-code-sm text-code-sm text-on-surface">
                  {p ? `${dateOrUnknown(p.opens_at)} → ${dateOrUnknown(p.closes_at)}` : UNKNOWN}
                </span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-space-xs self-start lg:self-end">
            <button
              type="button"
              onClick={() => onVote(row.id)}
              disabled={!isOpen}
              className="px-space-md py-space-sm bg-primary text-on-primary font-body-md font-semibold hover:bg-primary-container transition-colors disabled:opacity-40 flex items-center gap-space-xs"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                how_to_vote
              </span>
              {isOpen ? "Ir a votar" : "Votación no disponible"}
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter items-start">
        <div className="lg:col-span-7 flex flex-col gap-space-lg">
          <div className="bg-surface-container-lowest p-space-lg space-y-space-md">
            <h2 className="font-headline-md text-headline-md text-on-surface">
              Contenido direccionado por CID
            </h2>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              El texto de la iniciativa vive fuera de la cadena. Lo que la
              cadena garantiza es que estos hashes no han cambiado desde el
              registro.
            </p>
            <div className="bg-surface-container-low p-space-sm space-y-space-xs">
              <HashRow label="TÍTULO (HASH)" value={p?.title_hash ?? null} />
              <HashRow label="DESCRIPCIÓN (HASH)" value={p?.description_hash ?? null} />
              <HashRow label="METADATOS (HASH)" value={p?.metadata_hash ?? null} />
              <HashRow label="CID DE CONTENIDO" value={p?.content_cid ?? null} raw />
              <HashRow label="RAÍZ DE EVIDENCIA" value={p?.evidence_root ?? null} />
            </div>
          </div>

          <div className="bg-surface-container-lowest p-space-lg space-y-space-md">
            <div className="flex items-center gap-space-xs">
              <span className="material-symbols-outlined text-primary text-[22px]" aria-hidden="true">
                verified_user
              </span>
              <h2 className="font-headline-md text-headline-md text-on-surface">
                Evidencias adjuntas en cadena
              </h2>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Hashes añadidos por el proponente con <code>attach_evidence</code>.
              Solo hashes: el contenido vive fuera de la cadena.
            </p>
            {!p || p.evidence.length === 0 ? (
              <p className="font-code-sm text-code-sm text-outline">
                [{p ? "SIN EVIDENCIAS ADJUNTAS" : UNKNOWN}]
              </p>
            ) : (
              <ul className="space-y-space-xs">
                {p.evidence.map((h, i) => (
                  <li
                    key={`${h}-${i}`}
                    className="flex items-center justify-between bg-surface-container-low p-space-sm font-code-sm text-code-sm"
                  >
                    <span className="text-outline">EVD-#{i + 1}</span>
                    <span className="text-on-surface brujula-break" title={h}>
                      {shortHash(h, 16, 8)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-surface-container-lowest p-space-lg space-y-space-md">
            <h2 className="font-headline-md text-headline-md text-on-surface">
              Reportes anclados para esta iniciativa
            </h2>
            {reports.length === 0 ? (
              <p className="font-code-sm text-code-sm text-outline">[SIN REPORTES ANCLADOS]</p>
            ) : (
              <ul className="space-y-space-xs">
                {reports.map(({ id, report }) => (
                  <li key={id.toString()} className="bg-surface-container-low p-space-sm font-code-sm text-code-sm">
                    {report.status === "ok" && report.value ? (
                      <span className="text-on-surface">
                        Reporte #{report.value.id.toString()} · tipo {report.value.kind} · hash{" "}
                        <span className="brujula-break" title={report.value.report_hash}>
                          {shortHash(report.value.report_hash, 12, 6)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-outline">
                        Reporte #{id.toString()} · {UNKNOWN}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 flex flex-col gap-space-lg">
          <div className="bg-surface-container-lowest p-space-lg space-y-space-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-outline text-[20px]" aria-hidden="true">
                  analytics
                </span>
                <h3 className="font-headline-md text-headline-md text-on-surface">Escrutinio</h3>
              </div>
              <span className="font-code-sm text-code-sm text-primary font-semibold">
                {verdict === "verified" ? "[✓ VERIFICADO]" : verdict === "mismatch" ? "[⚠ INCONSISTENTE]" : `[? ${UNKNOWN}]`}
              </span>
            </div>
            <div className="space-y-space-xs">
              <div className="flex justify-between items-baseline font-body-sm text-body-sm">
                <span className="text-on-surface font-semibold">
                  Votos totales: {total === null ? UNKNOWN : total.toString()}
                </span>
                <span className="font-code-sm text-code-sm text-outline">
                  modo: {tally?.status === "ok" ? (tally.value.mode ?? UNKNOWN) : UNKNOWN}
                </span>
              </div>
              {counts.length === 0 ? (
                <p className="font-code-sm text-code-sm text-outline">[SIN VOTOS REGISTRADOS]</p>
              ) : (
                <>
                  <div className="w-full h-4 flex overflow-hidden bg-surface-container">
                    {counts.map((c) => (
                      <div
                        key={c.choice}
                        className="bg-primary h-full"
                        style={{ width: `${c.pct}%` }}
                        title={`Opción ${c.choice}: ${c.n.toString()}`}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-space-xs pt-1">
                    {counts.map((c) => (
                      <div key={c.choice} className="p-space-xs bg-surface-container-low">
                        <span className="font-code-sm text-code-sm text-primary block font-semibold">
                          {c.pct}%
                        </span>
                        <span className="text-on-surface-variant font-body-sm text-body-sm">
                          Opción {c.choice} ({c.n.toString()})
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="bg-surface-container-low p-space-md space-y-space-xs">
            <div className="flex items-center gap-space-xs text-on-surface font-semibold font-body-md text-body-md">
              <span className="material-symbols-outlined text-[20px] text-primary" aria-hidden="true">
                policy
              </span>
              <span>Nota de privacidad</span>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              El modo <code>public_v1</code> es transparente por diseño. El modo{" "}
              <code>commitment_v1</code> oculta la dirección en el recuento pero
              no prueba pertenencia y no es anonimato.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function HashRow({ label, value, raw = false }: { label: string; value: string | null | undefined; raw?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-space-sm">
      <span className="font-code-sm text-code-sm text-outline shrink-0">{label}:</span>
      <span
        className="font-code-sm text-code-sm text-on-surface text-right brujula-break"
        title={value ?? UNKNOWN}
      >
        {value ? (raw ? value : shortHash(value, 16, 8)) : UNKNOWN}
      </span>
    </div>
  );
}
