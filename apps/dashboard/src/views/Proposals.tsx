/**
 * Proposals grid — read straight from `brujula-proposal`.
 *
 * The homologated base shows cards with photos, budgets, contractors, quorums
 * and invented ids. None of that exists on chain, so none of it is rendered:
 * a card shows the on-chain id, the computed status, the proposer, the content
 * hashes and the voting window. Unknown stays unknown.
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
  onOpen,
}: {
  rows: ProposalRow[];
  nextId: Read<bigint>;
  loading: boolean;
  onOpen: (proposalId: bigint) => void;
}) {
  const [filter, setFilter] = useState<Filter>("todas");

  const visible = useMemo(() => {
    if (filter === "todas") return rows;
    const wantOpen = filter === "abiertas";
    return rows.filter((r) =>
      r.status.status === "ok" ? (r.status.value === PROPOSAL_STATUS.OPEN) === wantOpen : true,
    );
  }, [rows, filter]);

  const total =
    nextId.status === "ok" && nextId.value > 0n ? Number(nextId.value - 1n) : null;

  return (
    <section className="py-space-xl" id="proposals">
      <div className="space-y-space-lg">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-space-sm pb-space-sm">
          <div className="space-y-space-xs">
            <span className="font-code-sm text-code-sm text-primary uppercase font-bold tracking-wider">
              Consultas ciudadanas
            </span>
            <h2 className="font-headline-lg text-headline-lg text-on-surface font-bold">
              Iniciativas registradas
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
              Cada iniciativa existe en la cadena con su ventana de votación y
              sus hashes de contenido. El texto completo vive fuera de la
              cadena, dirigido por su CID.
            </p>
          </div>
          <div className="flex items-center gap-space-sm" role="group" aria-label="Filtrar propuestas">
            <span className="font-code-sm text-code-sm text-outline">FILTRO:</span>
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                aria-pressed={filter === f.value}
                className={`px-space-sm py-1 font-code-sm text-code-sm ${
                  filter === f.value
                    ? "bg-surface-container-highest text-on-surface font-semibold"
                    : "bg-surface-container text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {f.label}
                {f.value === "todas" && total !== null ? ` (${total})` : ""}
              </button>
            ))}
          </div>
        </div>

        <p className="font-code-sm text-code-sm text-outline">
          {loading
            ? "leyendo propuestas desde Stellar…"
            : nextId.status === "ok"
              ? `${total} propuesta(s) en cadena`
              : `total desconocido: ${nextId.reason}`}
        </p>

        {loading ? (
          <LoadingState label="CARGANDO" reason="leyendo propuestas desde Stellar testnet…" />
        ) : visible.length === 0 ? (
          <LoadingState
            label="SIN INICIATIVAS"
            reason={
              nextId.status === "unknown"
                ? `no se pudo leer el total: ${nextId.reason}`
                : rows.length === 0
                  ? "no hay propuestas registradas en la cadena aún"
                  : "ninguna propuesta coincide con este filtro"
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
            {visible.map((row) => (
              <ProposalCard key={row.id.toString()} row={row} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function LoadingState({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="flex items-center gap-space-sm p-space-md bg-surface-container-low border border-dashed border-outline">
      <span className="font-code-sm text-code-sm font-bold text-outline">[{label}]</span>
      <span className="font-body-sm text-body-sm text-on-surface-variant">{reason}</span>
    </div>
  );
}

function statusChip(status: Read<number>): { label: string; cls: string } {
  if (status.status !== "ok") return { label: UNKNOWN, cls: "bg-surface-container text-outline" };
  const label = PROPOSAL_STATUS_LABEL[status.value] ?? UNKNOWN;
  const cls =
    status.value === PROPOSAL_STATUS.OPEN
      ? "bg-surface-container-lowest/95 text-primary"
      : status.value === PROPOSAL_STATUS.CANCELLED
        ? "bg-surface-container-lowest/95 text-tertiary-container"
        : "bg-surface-container-lowest/95 text-on-surface-variant";
  return { label, cls };
}

function ProposalCard({ row, onOpen }: { row: ProposalRow; onOpen: (id: bigint) => void }) {
  const { proposal, status } = row;
  const chip = statusChip(status);
  const isOpen = status.status === "ok" && status.value === PROPOSAL_STATUS.OPEN;

  return (
    <article className="bg-surface-container-lowest flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow">
      <div className="p-space-lg space-y-space-md">
        <div className="flex items-center justify-between">
          <span className={`px-space-sm py-1 font-code-sm text-code-sm font-bold shadow-sm ${chip.cls}`}>
            [{chip.label}]
          </span>
          <span className="px-space-sm py-0.5 bg-on-surface/85 text-surface font-code-sm text-code-sm">
            ID #{row.id.toString()}
          </span>
        </div>

        {proposal.status === "unknown" ? (
          <div className="space-y-space-xs">
            <span className="font-code-sm text-code-sm font-bold text-outline">[SIN LECTURA]</span>
            <p className="font-body-sm text-body-sm text-on-surface-variant">{reasonOf(proposal)}</p>
          </div>
        ) : proposal.value === null ? (
          <div className="space-y-space-xs">
            <span className="font-code-sm text-code-sm font-bold text-outline">[NO EXISTE]</span>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              la cadena no registra ninguna propuesta con id #{row.id.toString()}
            </p>
          </div>
        ) : (
          <div className="space-y-space-md">
            <div className="space-y-space-xs">
              <div className="font-code-sm text-code-sm text-outline">
                PROPONENTE <span className="text-on-surface">{shortAddress(proposal.value.proposer)}</span>
              </div>
              <h3 className="font-headline-md text-headline-md text-on-surface font-bold leading-snug" title={proposal.value.title_hash}>
                Título (hash): {shortHash(proposal.value.title_hash)}
              </h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                El texto de la iniciativa no vive en la cadena. Se direcciona
                por su CID y se ancla por hash.
              </p>
            </div>
            <div className="bg-surface-container-low p-space-sm space-y-space-xs">
              <SpecRow label="CID DE CONTENIDO" value={proposal.value.content_cid || UNKNOWN} mono />
              <SpecRow label="EVIDENCIA (ROOT)" value={shortHash(proposal.value.evidence_root)} mono />
              <SpecRow label="EVIDENCIAS ADJUNTAS" value={proposal.value.evidence.length.toString()} />
              <SpecRow
                label="VENTANA"
                value={`${dateOrUnknown(proposal.value.opens_at)} → ${dateOrUnknown(proposal.value.closes_at)}`}
              />
            </div>
          </div>
        )}
      </div>
      <div className="p-space-lg pt-0">
        <button
          type="button"
          onClick={() => onOpen(row.id)}
          disabled={!isOpen && proposal.status === "ok" && proposal.value !== null}
          className="w-full py-space-sm bg-primary text-on-primary font-body-md font-semibold hover:bg-primary-container transition-colors flex items-center justify-center gap-space-xs disabled:opacity-40"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            {isOpen ? "verified" : "visibility"}
          </span>
          {isOpen ? "Votar en esta iniciativa" : "Inspeccionar en cadena"}
        </button>
      </div>
    </article>
  );
}

function SpecRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-space-sm">
      <span className="font-code-sm text-code-sm text-outline shrink-0">{label}:</span>
      <span
        className={`font-body-sm text-body-sm text-on-surface text-right brujula-break ${mono ? "font-code-sm text-code-sm" : ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
