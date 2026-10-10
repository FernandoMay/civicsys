/**
 * Accountability — reports anchored in `brujula-accountability`.
 *
 * This section used to be a fabricated "Hermes Civic Intelligence" engine:
 * invented quotes, invented hashes, "12 FUENTES PROCESADAS", "100% IPFS
 * Anclado", all presented as audited fact. Hermes does not exist in this
 * codebase and Phase 3 is not started, so that claim has no evidence behind it
 * and was removed rather than relabelled (RFC BRUJULA-CIVICA-ARCH-001 §0.3).
 *
 * What is shown instead is real and checkable: the append-only report log.
 * Each row's `report_hash` and `evidence_hash` are bytes stored on-chain, and
 * anyone can re-read them from the contract.
 */

import type { Read, ReportView } from "@brugulacivica/sdk";
import { dateOrUnknown, reasonOf, shortAddress, shortHash, UNKNOWN } from "../lib/format.js";

export type ReportEntry = { id: bigint; report: Read<ReportView | null> };

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
    <section className="hermes-section" id="reportes">
      <div className="hermes-head">
        <div className="hermes-head-left">
          <div className="hermes-logo">
            <svg className="hermes-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" />
            </svg>
            <span className="hermes-label">Rendición de Cuentas</span>
            <span className="hermes-badge">SOLO-ANCLES</span>
          </div>
          <p className="hermes-lead">
            Registro inmutable de reportes anclados en la cadena. Cada fila es una
            entrada real de <code>brujula-accountability</code>: no existe función de
            edición ni de borrado, y una corrección se publica como un reporte nuevo.
          </p>
        </div>
        <div className="hermes-guarantee">
          <span className="guarantee-label">TOTAL ANCLADO:</span>
          <span className="guarantee-chip">
            {count.status === "ok" ? count.value.toString() : UNKNOWN}
          </span>
        </div>
      </div>

      <div className="hermes-matrix">
        <div className="matrix-head">
          <div className="matrix-title-row">
            <svg className="matrix-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
            <h3 className="matrix-title">Reportes Anclados</h3>
          </div>
          <p className="matrix-sub">
            Solo se listan reportes leídos de la cadena. Lo que no se puede leer, se
            muestra como desconocido.
          </p>
          <span className="matrix-count">
            {reports.length.toString()} MOSTRADOS
          </span>
        </div>

        {loading ? (
          <div className="unknown">
            <span className="chip chip-unknown">CARGANDO</span>
            <span className="reason">leyendo el registro de anclajes…</span>
          </div>
        ) : count.status === "unknown" ? (
          <div className="unknown">
            <span className="chip chip-unknown">{UNKNOWN}</span>
            <span className="reason">{reasonOf(count)}</span>
          </div>
        ) : reports.length === 0 ? (
          <div className="unknown">
            <span className="chip chip-unknown">SIN REPORTES</span>
            <span className="reason">
              el contrato responde correctamente, pero todavía no hay ningún reporte
              anclado
            </span>
          </div>
        ) : (
          <table className="evidence-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Propuesta</th>
                <th>Tipo</th>
                <th>Autor</th>
                <th>Hash del reporte</th>
                <th>Anclado</th>
              </tr>
            </thead>
            <tbody>
              {reports.map(({ id, report }) => (
                <ReportRow key={id.toString()} id={id} report={report} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="matrix-sub" style={{ marginTop: "12px" }}>
        Contrato de anclaje:{" "}
        <a
          href={`${explorerBase}/contract/${contractId}`}
          target="_blank"
          rel="noreferrer"
        >
          {contractId} ↗
        </a>
      </p>
    </section>
  );
}

function ReportRow({ id, report }: { id: bigint; report: Read<ReportView | null> }) {
  if (report.status === "unknown") {
    return (
      <tr>
        <td className="cell-mono">#{id.toString()}</td>
        <td colSpan={5}>
          <div className="unknown">
            <span className="chip chip-unknown">{UNKNOWN}</span>
            <span className="reason">{reasonOf(report)}</span>
          </div>
        </td>
      </tr>
    );
  }

  const r = report.value;
  if (r === null) {
    return (
      <tr>
        <td className="cell-mono">#{id.toString()}</td>
        <td colSpan={5} className="muted">
          el contrato no tiene ningún reporte con id {id.toString()}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="cell-mono">#{r.id.toString()}</td>
      <td className="cell-mono">#{r.proposal_id.toString()}</td>
      <td className="cell-kind">{r.kind}</td>
      <td className="cell-doc">{shortAddress(r.author)}</td>
      <td className="cell-hash" title={`report ${r.report_hash} · evidencia ${r.evidence_hash}`}>
        {shortHash(r.report_hash)}
      </td>
      <td className="cell-doc">{dateOrUnknown(r.anchored_at)}</td>
    </tr>
  );
}