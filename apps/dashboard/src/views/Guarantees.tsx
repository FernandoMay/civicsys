const BADGES = [
  {
    label: "[✓ VERIFICADO]",
    icon: "check",
    title: "Validación Criptográfica Completa",
    desc: "La firma digital coincide con la raíz pública del padrón municipal. Quórum ratificado en ledger.",
    variant: "ok",
  },
  {
    label: "[⚠ EN DISPUTA]",
    icon: "warn",
    title: "Objeción Fáctica Presentada",
    desc: "Un ciudadano o veedor acreditado ha adjuntado contradocumento oficial. El hito entra en deliberación pública.",
    variant: "warn",
  },
  {
    label: "[? DESCONOCIDO]",
    icon: "help",
    title: "Sin Registro Histórico",
    desc: "El hash o comprobante no figura en el árbol Merkle de la consulta vigente. Debe verificarse el archivo local.",
    variant: "muted",
  },
  {
    label: "[× FALLIDO]",
    icon: "cancel",
    title: "Firma Rechazada",
    desc: "Comprobante adulterado o emitido fuera de la ventana de votación. El ledger descarta automáticamente la entrada.",
    variant: "bad",
  },
];

export default function Guarantees() {
  return (
    <section className="guarantees-section">
      <div className="guarantees-card">
        <div className="guarantees-head">
          <div className="guarantees-head-left">
            <svg className="guarantees-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.02 2 2 6.02 2 12s4.02 10 10 10 10-4.02 10-10S17.98 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
            <h2 className="guarantees-title">Garantía Institucional de Verificación Fail-Closed</h2>
          </div>
          <a className="btn btn-secondary guarantees-link" href="#">
            <svg className="btn-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM10 9h4v6h-4z" />
            </svg>
            Ir al Verificador Público
          </a>
        </div>

        <p className="guarantees-lead">
          En CivicSys ningún registro es presuntamente válido. Cada transacción requiere
          prueba matemática. El sistema responde con estados inequívocos:
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
  const color = variant === "ok" ? "var(--ok)" : variant === "warn" ? "var(--warn)" : variant === "muted" ? "var(--outline)" : "var(--bad)";
  return (
    <svg
      className="badge-icon"
      style={{ color }}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      {icon === "check" && (
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
      )}
      {icon === "warn" && (
        <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
      )}
      {icon === "help" && (
        <path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 18h-2v-2h2v2zm4.9-1.7O4.5 8.5 0 15.83 0 17h2v-3.67c0-.83.67-1.5 1.5-1.5h3.17c.83 0 1.5.67 1.5 1.5V17h2v-1.83c0-.83.67-1.5 1.5-1.5h1.17c.42 0 .78.14 1.07.4 1.04.6 1.71 1.42 1.71 3.06 0 2.2-1.28 3.63-3.69 3.63-1.93 0-3.22-1.17-3.4-2.79H15V12h-2v3.83C8.78 15.71 8.44 16.63 8 17.3c-.69.93-1.58 1.5-3.21 1.5-2.58 0-4.5-2.12-4.5-4.22 0-2.32 1.95-4.04 4.5-4.04z" />
      )}
      {icon === "cancel" && (
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
      )}
    </svg>
  );
}
