import { ReportView } from "@civicsys/sdk";

interface EvidenceRow {
  id: string;
  document: string;
  kind: string;
  hash: string;
  status: "proven" | "audited" | "warning";
  source: string;
}

const EVIDENCE_ROWS: EvidenceRow[] = [
  {
    id: "EVD-084-A",
    document: "Estudio de Capacidad y Tráfico Vial 2025-2026",
    kind: "TÉCNICA",
    hash: "0x81cf...3e",
    status: "proven",
    source: "Secretaría de Obras Públicas · Archivo Nacional Notariado",
  },
  {
    id: "EVD-084-B",
    document: "Certificación de Cupo Presupuestario Municipal ($4,200,000 USD)",
    kind: "FINANZAS",
    hash: "0x07de...fa",
    status: "proven",
    source: "Tesorería Distrital · Comprobante Presupuesto N.º 2025-014",
  },
  {
    id: "EVD-084-C",
    document: "Evaluación de Ruido y Emisiones (Baseline)",
    kind: "AMBIENTAL",
    hash: "0x44ab...12",
    status: "proven",
    source: "Agencia Ambiental Metropolitana · Informe Técnico 1182",
  },
  {
    id: "EVD-084-D",
    document: "Adenda 2: Reubicación de Puntos de Carga (Vecinos San Juan)",
    kind: "CIUDADANA",
    hash: "0x99a2...99",
    status: "audited",
    source: "Asamblea Vecinal D14 · Acta Reunión 12 Jul 2026",
  },
];

const HERMES_SYNTHESIS = `
Sin objeciones ambientales. Capacidad de drenaje incrementa 42% frente a lluvias estacionales extremas.
`;

export default function HermesEvidence() {
  return (
    <section className="hermes-section">
      <div className="hermes-head">
        <div className="hermes-head-left">
          <div className="hermes-logo">
            <svg className="hermes-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
            <span className="hermes-label">Hermes Civic Intelligence</span>
            <span className="hermes-badge">MOTOR AUDITADO</span>
          </div>
          <p className="hermes-lead">
            Inteligencia documental que no inventa hechos: cita exclusivamente
            decretos, planos de ingeniería y balances presupuestarios oficiales.
          </p>
        </div>
        <div className="hermes-guarantee">
          <span className="guarantee-label">GARANTÍA DETERMINISTA:</span>
          <span className="guarantee-chip">CIP-0711 PROVENANCE SHA256</span>
        </div>
      </div>

      <div className="hermes-inspector">
        <div className="inspector-question">
          <span className="question-label">CONSULTA CIUDADANA AUDITADA:</span>
          {"¿Existe riesgo de corte de suministro eléctrico durante la obra de Av. San Juan?"}
          <span className="question-verified">[VERIFICACIÓN CONCLUIDA]</span>
        </div>

        <blockquote className="inspector-answer">
          "Hermes comprobó el pliego de especificaciones técnicas (Doc. REF-1092,
          Cláusula 14.2): El contratista está obligado por garantía bancaria a
          instalar generadores de respaldo continuo para hospitales y comercios.
          0 interrupciones programadas mayores a 20 minutos."
        </blockquote>

        <div className="inspector-foot">
          <span className="foot-hash">HASH DE CITA: 0x9bc2e11a43029f...</span>
          <span className="foot-source">Fuente: Secretaría de Obras Públicas · Archivo Nacional Notariado</span>
        </div>
      </div>

      <div className="hermes-matrix">
        <div className="matrix-head">
          <div className="matrix-title-row">
            <svg className="matrix-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
            <h3 className="matrix-title">Matriz de Evidencias Auditadas</h3>
          </div>
          <p className="matrix-sub">Procesamiento descentralizado mediante capa Hermes Evidence Engine</p>
          <span className="matrix-count">12 FUENTES PROCESADAS</span>
        </div>

        <div className="matrix-stats">
          <div className="matrix-stat">
            <span className="stat-label">VERIFICACIÓN CRÍPTICA</span>
            <span className="stat-value proven">9 / 12 Sin Objeciones</span>
          </div>
          <div className="matrix-stat">
            <span className="stat-label">OBSERVACIONES VECINALES</span>
            <span className="stat-value warning">2 Resueltas en Pleno</span>
          </div>
          <div className="matrix-stat">
            <span className="stat-label">REQUISITO DE DISPONIBILIDAD</span>
            <span className="stat-value">100% IPFS Anclado</span>
          </div>
        </div>

        <table className="evidence-table">
          <thead>
            <tr>
              <th>ID Fuente</th>
              <th>Documento / Prueba</th>
              <th>Tipo</th>
              <th>Estado Hermes</th>
              <th className="text-right">Comprobación</th>
            </tr>
          </thead>
          <tbody>
            {EVIDENCE_ROWS.map((r) => (
              <tr key={r.id}>
                <td className="cell-mono">{r.id}</td>
                <td className="cell-doc">{r.document}</td>
                <td className="cell-kind">{r.kind}</td>
                <td>
                  <span className={`status-pill status-${r.status}`}>
                    {statusLabel(r.status)}
                  </span>
                </td>
                <td className="cell-hash text-right">
                  <button className="hash-link" onClick={() => alert(`Hash de comprobación: ${r.hash}`)}>
                    {r.hash}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function statusLabel(status: EvidenceRow["status"]): string {
  return status === "proven" ? "[✓ CIP-PROVED // SHA-256]" : status === "audited" ? "[✓ AUDITADA]" : "[⚠ OBSERVACIÓN]";
}
