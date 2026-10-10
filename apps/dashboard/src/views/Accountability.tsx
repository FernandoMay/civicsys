/**
 * Accountability — reports anchored in `brujula-accountability`.
 *
 * The append-only report log: each row's `report_hash` and `evidence_hash` are
 * bytes stored on-chain, and anyone can re-read them from the contract. There
 * is no update or delete entrypoint; corrections are new reports.
 *
 * Hermes reports (kind "hermes") appear here like any other anchor. Their
 * findings are reproducible off-chain from the committed evidence files in
 * `deployments/hermes/`; this table shows the on-chain half of that proof.
 */

import type { Read, ReportView } from "@brugulacivica/sdk";
import type { ReportEntry } from "../lib/chain.js";
import { dateOrUnknown, reasonOf, shortAddress, shortHash, UNKNOWN } from "../lib/format.js";

export type { ReportEntry };

export default function Accountability({
  count,
  reports,
  loading,
  explorerBase,
  contractId,
}: {
  count: Read<bigint>;
  reports: ReportEntry[];
  loading: boolean;
  explorerBase: string;
  contractId: string;
}) {
  return (
    <section className="py-space-xl bg-surface-container-low" id="reportes">
      <div className="p-space-lg space-y-space-md">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-space-md">
          <div className="flex items-center gap-space-sm">
            <div className="w-12 h-12 bg-primary text-on-primary flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[28px]" aria-hidden="true">
                query_stats
              </span>
            </div>
            <div>
              <div className="flex items-center gap-space-xs flex-wrap">
                <span className="font-headline-md text-headline-md text-on-surface font-bold">
                  Rendición de Cuentas
                </span>
                <span className="font-code-sm text-code-sm bg-primary text-on-primary px-space-xs py-0.5">
                  REGISTRO INMUTABLE
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Cada fila es una entrada real de <code>brujula-accountability</code>:
                sin edición ni borrado; una corrección es un reporte nuevo.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-space-sm shrink-0">
            <span className="font-code-sm text-code-sm text-outline">TOTAL ANCLADO:</span>
            <span className="font-code-sm text-code-sm bg-surface-container-lowest px-space-sm py-1 font-semibold text-primary">
              {count.status === "ok" ? count.value.toString() : UNKNOWN}
            </span>
          </div>
        </div>

        <div className="bg-surface-container-lowest p-space-md space-y-space-sm">
          <div className="flex items-center justify-between font-code-sm text-code-sm">
            <span className="text-outline">
              Solo reportes leídos de la cadena. Lo no legible se muestra como desconocido.
            </span>
            <span className="text-on-surface font-semibold">{reports.length.toString()} MOSTRADOS</span>
          </div>

          {loading ? (
            <LoadingRow label="CARGANDO" reason="leyendo el registro de anclajes…" />
          ) : count.status === "unknown" ? (
            <LoadingRow label={UNKNOWN} reason={reasonOf(count) ?? "sin lectura"} />
          ) : reports.length === 0 ? (
            <LoadingRow
              label="SIN REPORTES"
              reason="el contrato responde correctamente, pero todavía no hay ningún reporte anclado"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left font-body-sm text-body-sm">
                <thead>
                  <tr className="bg-surface-container-high text-on-surface-variant font-code-sm text-code-sm uppercase">
                    <th className="py-2.5 px-space-sm">ID</th>
                    <th className="py-2.5 px-space-sm">Propuesta</th>
                    <th className="py-2.5 px-space-sm">Tipo</th>
                    <th className="py-2.5 px-space-sm">Autor</th>
                    <th className="py-2.5 px-space-sm">Hash del reporte</th>
                    <th className="py-2.5 px-space-sm">Anclado</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map(({ id, report }, i) => (
                    <ReportRow key={id.toString()} id={id} report={report} striped={i % 2 === 1} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="font-code-sm text-code-sm text-outline">
          Contrato de anclaje:{" "}
          <a className="text-primary hover:underline brujula-break" href={`${explorerBase}/contract/${contractId}`} target="_blank" rel="noreferrer">
            {contractId} ↗
          </a>
        </p>
      </div>
    </section>
  );
}

function LoadingRow({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="flex items-center gap-space-sm p-space-sm bg-surface-container-low">
      <span className="font-code-sm text-code-sm font-bold text-outline">[{label}]</span>
      <span className="font-body-sm text-body-sm text-on-surface-variant">{reason}</span>
    </div>
  );
}

function ReportRow({ id, report, striped }: { id: bigint; report: Read<ReportView | null>; striped: boolean }) {
  const rowCls = striped ? "bg-surface-container-low/50" : "bg-surface-container-lowest";
  if (report.status === "unknown") {
    return (
      <tr className={rowCls}>
        <td className="py-2.5 px-space-sm font-code-sm text-code-sm text-outline">#{id.toString()}</td>
        <td colSpan={5} className="py-2.5 px-space-sm font-code-sm text-code-sm text-outline">
          [{UNKNOWN}] {reasonOf(report)}
        </td>
      </tr>
    );
  }
  const r = report.value;
  if (r === null) {
    return (
      <tr className={rowCls}>
        <td className="py-2.5 px-space-sm font-code-sm text-code-sm text-outline">#{id.toString()}</td>
        <td colSpan={5} className="py-2.5 px-space-sm font-body-sm text-body-sm text-on-surface-variant">
          el contrato no tiene ningún reporte con id {id.toString()}
        </td>
      </tr>
    );
  }
  return (
    <tr className={`${rowCls} hover:bg-surface-container-low transition-colors`}>
      <td className="py-2.5 px-space-sm font-code-sm text-code-sm text-outline">#{r.id.toString()}</td>
      <td className="py-2.5 px-space-sm font-code-sm text-code-sm text-on-surface">#{r.proposal_id.toString()}</td>
      <td className="py-2.5 px-space-sm font-code-sm text-code-sm text-on-surface">{r.kind}</td>
      <td className="py-2.5 px-space-sm font-body-sm text-body-sm text-on-surface" title={r.author}>
        {shortAddress(r.author)}
      </td>
      <td className="py-2.5 px-space-sm font-code-sm text-code-sm text-primary brujula-break" title={`reporte ${r.report_hash} · evidencia ${r.evidence_hash}`}>
        {shortHash(r.report_hash)}
      </td>
      <td className="py-2.5 px-space-sm font-body-sm text-body-sm text-on-surface-variant">
        {dateOrUnknown(r.anchored_at)}
      </td>
    </tr>
  );
}
