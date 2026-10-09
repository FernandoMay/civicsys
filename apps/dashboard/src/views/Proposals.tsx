import { ProposalView, PROPOSAL_STATUS_LABEL, type Read } from "@civicsys/sdk";
import type { ProposalRow } from "../lib/chain.js";

interface ProposalCardProps {
  row: ProposalRow;
}

const STATUS_BADGE: Record<number, { label: string; variant: string }> = {
  0: { label: "Programada", variant: "outline" },
  1: { label: "En Votación", variant: "primary" },
  2: { label: "Cerrada", variant: "outline" },
  3: { label: "Cancelada", variant: "warn" },
};

export default function Proposals({ rows, nextId, loading }: {
  rows: ProposalRow[];
  nextId: { status: "ok" | "unknown"; value?: bigint; reason?: string };
  loading: boolean;
}) {
  return (
    <section className="proposals-section" id="proposals">
      <div className="proposals-head">
        <div className="proposals-head-left">
          <span className="section-eyebrow">Consultas Comunitarias Vigentes</span>
          <h2 className="section-title">Iniciativas Públicas Prioritarias</h2>
          <p className="section-lead">
            Proyectos con financiamiento municipal asignado. Cada voto se registra
            directamente en la cadena Stellar con evidencia documental auditada por
            Hermes.
          </p>
        </div>
        <div className="proposals-filter">
          <span className="filter-label">FILTRO:</span>
          <button className="filter-btn filter-active">TODAS</button>
          <button className="filter-btn">MOVILIDAD</button>
          <button className="filter-btn">ENERGÍA</button>
        </div>
      </div>

      <div className="proposals-head" style={{ marginTop: "16px" }}>
        <span className="muted">
          {loading
            ? "cargando iniciativas desde Stellar…"
            : nextId.status === "ok"
              ? `next id ${nextId.value?.toString() ?? "?"}`
              : `cuenta de iniciativas desconocida: ${nextId.reason ?? "?"}`}
        </span>
      </div>

      {loading ? (
        <div className="unknown">
          <span className="chip chip-unknown">CARGANDO</span>
          <span className="reason">leyendo propuestas desde Stellar testnet…</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="unknown">
          <span className="chip chip-unknown">SIN INICIATIVAS</span>
          <span className="reason">
            {nextId.status === "unknown"
              ? `no se pudo leer la cuenta de iniciativas: ${nextId.reason}`
              : "no hay propuestas registradas en la cadena aún"}
          </span>
        </div>
      ) : (
        <div className="proposals-grid">
          {rows.map((row) => (
            <ProposalCard key={row.id.toString()} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}

function getStatusBadge(status: Read<number>): { label: string; variant: string } {
  if (status.status === "ok" && typeof status.value === "number") {
    const candidate = STATUS_BADGE[status.value];
    return (candidate ?? STATUS_BADGE[0]) as { label: string; variant: string };
  }
  return STATUS_BADGE[0] as { label: string; variant: string };
}

function ProposalCard({ row }: ProposalCardProps) {
  const { proposal, status } = row;

  const statusBadge = getStatusBadge(status);
  const idLabel = `CIV-2025-${String(Number(row.id) + 1).padStart(2, "0")}`;

  if (proposal.status === "unknown") {
    return (
      <article className="proposal-card">
        <div className="proposal-media">
          <span className="proposal-id-badge">ID: {idLabel}</span>
        </div>
        <div className="proposal-body">
          <div className="unknown">
            <span className="chip chip-unknown">PROXIMA INICIATIVA</span>
            <span className="reason">no se pudo leer la propuesta {idLabel} desde la cadena: {proposal.reason}</span>
          </div>
        </div>
      </article>
    );
  }

  const p = proposal.value;
  if (p === null) {
    return (
      <article className="proposal-card">
        <div className="proposal-media">
          <span className="proposal-id-badge">ID: {idLabel}</span>
        </div>
        <div className="proposal-body">
          <div className="unknown">
            <span className="chip chip-unknown">SIN REGISTRO</span>
            <span className="reason">no existe propuesta {idLabel} en la cadena</span>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="proposal-card">
      <div className="proposal-media">
        <span className={`proposal-status-badge badge-${statusBadge.variant}`}>
          {statusBadge.label.toUpperCase()}
        </span>
        <span className="proposal-id-badge">ID: {idLabel}</span>
      </div>

      <div className="proposal-body">
        <div className="proposal-head">
          <div className="proposal-meta-top">
            <span className="proposal-district">{p.proposer.slice(0, 10)}…{p.proposer.slice(-4)}</span>
            <span className="proposal-budget-label">PRESUPUESTO ASIGNADO</span>
          </div>
          <h3 className="proposal-title">Hash: {p.title_hash.slice(0, 10)}…{p.title_hash.slice(-6)}</h3>
          <p className="proposal-desc">
            Contenido fuera de cadena — CID: {p.content_cid.slice(0, 20)}…
          </p>
        </div>

        <div className="proposal-budget-row">
          <span className="budget-key">CONTENIDO:</span>
          <span className="budget-value">{p.content_cid}</span>
        </div>
        <div className="proposal-budget-row">
          <span className="budget-key">EVIDENCIA ROOT:</span>
          <span className="budget-value budget-medium">{p.evidence_root.slice(0, 10)}…{p.evidence_root.slice(-6)}</span>
        </div>

        <div className="proposal-participation">
          <div className="participation-head">
            <span className="participation-label">Ventana de votación:</span>
            <span className="participation-value">
              {new Date(Number(p.opens_at) * 1000).toLocaleDateString()} →
              {new Date(Number(p.closes_at) * 1000).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>

      <div className="proposal-action">
        <button className="btn btn-primary proposal-cta" onClick={() => alert(`Boleta para propuesta ${idLabel}: hash de título ${p.title_hash.slice(0, 10)}…`)}>
          <svg className="btn-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
          Apoyar e Inspeccionar
        </button>
      </div>
    </article>
  );
}
