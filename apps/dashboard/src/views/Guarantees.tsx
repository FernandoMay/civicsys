/**
 * Guarantees — an honest legend of the states this app can actually show.
 *
 * This is documentation rendered as UI, not a claim about any particular record.
 * Every badge below corresponds to a real outcome of the SDK verifier
 * (RFC BRUJULA-CIVICA-ARCH-001 §6).
 */

import { deployment } from "../lib/chain.js";

const BADGES = [
  {
    label: "[✓ VERIFICADO]",
    icon: "check",
    title: "Consistencia probada",
    desc: "Todas las reglas deterministas del recuento se cumplen: total = suma de opciones = votos públicos + de compromiso.",
    variant: "ok",
  },
  {
    label: "[⚠ INCONSISTENTE]",
    icon: "warn",
    title: "El dato no cuadra",
    desc: "El recuento leído viola al menos una regla. Puede indicar corrupción o manipulación: el verificador lo señala en vez de ocultarlo.",
    variant: "warn",
  },
  {
    label: "[? DESCONOCIDO]",
    icon: "help",
    title: "Sin dato verificable",
    desc: "La cadena no respondió o la propiedad no es demostrable todavía. Se muestra DESCONOCIDO; nunca se rellena con un valor por defecto.",
    variant: "muted",
  },
  {
    label: "[× FALLIDO]",
    icon: "cancel",
    title: "Transacción rechazada",
    desc: "El propio contrato rechazó la operación: ventana cerrada, voto repetido o credencial no habilitada.",
    variant: "bad",
  },
];

export default function Guarantees() {
  const explorerBase = `https://stellar.expert/explorer/${deployment.network}`;
  const contractHref = `${explorerBase}/contract/${deployment.contracts["brujula-vote"]!.contract_id}`;

  return (
    <section className="guarantees-section">
      <div className="guarantees-card">
        <div className="guarantees-head">
          <div className="guarantees-head-left">
            <svg className="guarantees-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.02 2 2 6.02 2 12s4.02 10 10 10 10-4.02 10-10S17.98 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
            <h2 className="guarantees-title">Garantía de Verificación Fail-Closed</h2>
          </div>
          <a className="btn btn-secondary guarantees-link" href={contractHref} target="_blank" rel="noreferrer">
            <svg className="btn-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM10 9h4v6h-4z" />
            </svg>
            Abrir el contrato en el explorador
          </a>
        </div>

        <p className="guarantees-lead">
          Ningún registro se da por válido por presunción. El sistema solo afirma
          lo que puede probar y declara <code>DESCONOCIDO</code> en el resto de casos.
          Estos son los únicos cuatro estados que la interfaz puede mostrar.
        </p>

        <div className="badges-grid">
          {BADGES.map((b) => (
            <div key={b.label} className={`badge-card badge-${b.variant}`}>
              <div className="badge-head">
                <span className={`badge-label badge-label-${b.variant}`}>{b.label}</span>
                <BadgeIcon icon={b.icon} variant={b.variant} />
              </div>
              <h3 className="badge-title">{b.title}</h3>
              <p className="badge-desc">{b.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BadgeIcon({ icon, variant }: { icon: string; variant: string }) {
  const color =
    variant === "ok"
      ? "var(--ok)"
      : variant === "warn"
        ? "var(--warn)"
        : variant === "muted"
          ? "var(--outline)"
          : "var(--bad)";
  return (
    <svg className="badge-icon" style={{ color }} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {icon === "check" && <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />}
      {icon === "warn" && <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />}
      {icon === "help" && (
        <path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z" />
      )}
      {icon === "cancel" && (
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
      )}
    </svg>
  );
}