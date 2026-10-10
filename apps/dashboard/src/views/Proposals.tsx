/**
 * Proposals — read straight from `brujula-proposal`.
 *
 * Two honesty bugs in the previous version are fixed here:
 *   1. an unreadable status used to render as "Programada" (a fabricated
 *      default). It now renders DESCONOCIDO;
 *   2. ids were relabelled `CIV-2025-<id + 1>`, an invented scheme that was
 *      also off by one. The on-chain id is now shown verbatim.
 */

import { useMemo, useState } from "react";

import { PROPOSAL_STATUS, PROPOSAL_STATUS_LABEL, type Read } from "@brugulacivica/sdk";
import type { ProposalRow } from "../lib/chain.js";
import { dateOrUnknown, reasonOf, shortAddress, shortHash, UNKNOWN } from "../lib/format.js";

type Filter = "todas" | "abiertas" | "cerradas";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "todas", label: "TODAS" },
  { value: "abiertas", label: "ABIERTAS" },
  { value: "cerradas", label: "CERRADAS" },
];

export default function Proposals({
  rows,
  nextId,
  loading,
  onVote,
}: {
  rows: ProposalRow[];
  nextId: Read<bigint>;
  loading: boolean;
  onVote: (proposalId: bigint) => void;
}) {
  const [filter, setFilter] = useState<Filter>("todas");

  const visible = useMemo(() => {
    if (filter === "todas") return rows;
    const wantOpen = filter === "abiertas";
    return rows.filter((r) =>
      r.status.status === "ok" ? (r.status.value === PROPOSAL_STATUS.OPEN) === wantOpen : true,
    );
  }, [rows, filter]);

  return (
    <section className="proposals-section" id="proposals">
      <div className="proposals-head">
        <div className="proposals-head-left">
          <span className="section-eyebrow">Consultas Ciudadanas</span>
          <h2 className="section-title">Iniciativas Registradas</h2>
          <p className="section-lead">
            Cada iniciativa existe en la cadena con su ventana de votación y sus
            hashes de contenido. El texto completo vive fuera de la cadena, dirigido
            por su CID.
          </p>
        </div>
        <div className="proposals-filter" role="group" aria-label="Filtrar propuestas">
          <span className="filter-label">FILTRO:</span>
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`filter-btn ${filter === f.value ? "filter-active" : ""}`}
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="proposals-head" style={{ marginTop: "16px" }}>
        <span className="muted">
          {loading
            ? "leyendo propuestas desde Stellar…"
            : nextId.status === "ok"
              ? `${nextId.value > 0n ? (nextId.value - 1n).toString() : "0"} propuestas en cadena`
              : `total de propuestas desconocido: ${nextId.reason}`}
        </span>
      </div>

      {loading ? (
        <div className="unknown">
          <span className="chip chip-unknown">CARGANDO</span>
          <span className="reason">leyendo propuestas desde Stellar testnet…</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="unknown">
          <span className="chip chip-unknown">SIN INICIATIVAS</span>
          <span className="reason">
            {nextId.status === "unknown"
              ? `no se pudo leer el total de propuestas: ${nextId.reason}`
              : rows.length === 0
                ? "no hay propuestas registradas en la cadena aún"
                : "ninguna propuesta coincide con este filtro"}
          </span>
        </div>
      ) : (
        <div className="proposals-grid">
          {visible.map((row) => (
            <ProposalCard key={row.id.toString()} row={row} onVote={onVote} />
          ))}
        </div>
      )}
    </section>
  );
}

type Badge = { label: string; variant: string };

/** Unknown status is its own badge — never silently coerced to a known state. */
function statusBadge(status: Read<number>): Badge {
  if (status.status !== "ok") return { label: UNKNOWN, variant: "unknown" };
  const label = PROPOSAL_STATUS_LABEL[status.value] ?? UNKNOWN;
  const variant =
    status.value === PROPOSAL_STATUS.OPEN
      ? "primary"
      : status.value === PROPOSAL_STATUS.CANCELLED
        ? "warn"
        : "outline";
  return { label, variant };
}

function ProposalCard({
  row,
  onVote,
}: {
  row: ProposalRow;
  onVote: (proposalId: bigint) => void;
}) {
  const { proposal, status } = row;
  const badge = statusBadge(status);
  const idLabel = `#${row.id.toString()}`;
  const isOpen = status.status === "ok" && status.value === PROPOSAL_STATUS.OPEN;

  if (proposal.status === "unknown") {
    return (
      <article className="proposal-card">
        <div className="proposal-media">
          <span className={`proposal-status-badge badge-${badge.variant}`}>
            {badge.label}
          </span>
          <span className="proposal-id-badge">ID {idLabel}</span>
        </div>
        <div className="proposal-body">
          <div className="unknown">
            <span className="chip chip-unknown">SIN LECTURA</span>
            <span className="reason">{reasonOf(proposal)}</span>
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
          <span className={`proposal-status-badge badge-${badge.variant}`}>
            {badge.label}
          </span>
          <span className="proposal-id-badge">ID {idLabel}</span>
        </div>
        <div className="proposal-body">
          <div className="unknown">
            <span className="chip chip-unknown">NO EXISTE</span>
            <span className="reason">
              la cadena no registra ninguna propuesta con id {idLabel}
            </span>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="proposal-card">
      <div className="proposal-media">
        <span className={`proposal-status-badge badge-${badge.variant}`}>
          {badge.label.toUpperCase()}
        </span>
        <span className="proposal-id-badge">ID {idLabel}</span>
      </div>

      <div className="proposal-body">
        <div className="proposal-head">
          <div className="proposal-meta-top">
            <span className="proposal-district">{shortAddress(p.proposer)}</span>
            <span className="proposal-budget-label">PROPONENTE</span>
          </div>
          <h3 className="proposal-title" title={p.title_hash}>
            Título (hash): {shortHash(p.title_hash)}
          </h3>
          <p className="proposal-desc">
            El texto de la iniciativa no vive en la cadena. Se direcciona por su
            CID y se ancla por hash.
          </p>
        </div>

        <div className="proposal-budget-row">
          <span className="budget-key">CID DE CONTENIDO:</span>
          <span className="budget-value" title={p.content_cid}>
            {p.content_cid || UNKNOWN}
          </span>
        </div>
        <div className="proposal-budget-row">
          <span className="budget-key">EVIDENCIA (ROOT):</span>
          <span className="budget-value budget-medium" title={p.evidence_root}>
            {shortHash(p.evidence_root)}
          </span>
        </div>
        <div className="proposal-budget-row">
          <span className="budget-key">EVIDENCIAS ADJUNTAS:</span>
          <span className="budget-value">{p.evidence.length.toString()}</span>
        </div>

        <div className="proposal-participation">
          <div className="participation-head">
            <span className="participation-label">Ventana de votación:</span>
            <span className="participation-value">
              {dateOrUnknown(p.opens_at)} → {dateOrUnknown(p.closes_at)}
            </span>
          </div>
        </div>
      </div>

      <div className="proposal-action">
        <button
          type="button"
          className="btn btn-primary proposal-cta"
          disabled={!isOpen}
          onClick={() => onVote(row.id)}
        >
          <svg className="btn-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
          </svg>
          {isOpen ? "Votar en esta iniciativa" : "Votación no disponible"}
        </button>
      </div>
    </article>
  );
}