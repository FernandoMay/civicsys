export default function Landing() {
  return (
    <section className="landing">
      <div className="landing-top">
        <div className="landing-eyebrow">
          <span className="eyebrow-chip">CIP-0104 · Infraestructura Cívica Verificable</span>
          <span className="eyebrow-meta">Edición Ciudadana</span>
        </div>
        <h1 className="landing-title">
          Decisiones cívicas.<br />
          <span className="title-accent">Verificables por diseño.</span>
        </h1>
        <p className="landing-lead">
          Plataforma pública abierta para participar en proyectos comunitarios
          prioritarios, deliberar sobre evidencia auditada y supervisar el uso de
          fondos colectivos con pruebas que tú mismo puedes certificar.
        </p>
      </div>

      <div className="landing-metrics">
        <div className="metric">
          <div className="metric-label">Iniciativas</div>
          <div className="metric-value">14</div>
          <div className="metric-sub">Activas hoy</div>
        </div>
        <div className="metric">
          <div className="metric-label">Vecinos</div>
          <div className="metric-value">4,892</div>
          <div className="metric-sub">Acreditados</div>
        </div>
        <div className="metric">
          <div className="metric-label">Decisiones</div>
          <div className="metric-value">38</div>
          <div className="metric-sub">Ratificadas</div>
        </div>
        <div className="metric">
          <div className="metric-label">Auditoría</div>
          <div className="metric-value">100%</div>
          <div className="metric-sub">Inmutable</div>
        </div>
      </div>

      <div className="landing-actions">
        <a className="btn btn-primary" href="#proposals">
          <svg className="btn-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
          Explorar Iniciativas
        </a>
        <button className="btn btn-secondary" onClick={() => document.getElementById("credential-modal")?.classList.remove("hidden")}>
          <svg className="btn-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
          </svg>
          Verificar con Mi Credencial
        </button>
      </div>

      <div className="credential-card" aria-labelledby="credential-title">
        <div className="credential-head">
          <svg className="credential-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <span className="credential-title" id="credential-title">Credencial Cívica Digital</span>
          <span className="badge-verified">[✓ PADRÓN VERIFICADO]</span>
        </div>

        <div className="credential-body">
          <div className="credential-row">
            <div className="credential-info">
              <span className="credential-key">TITULAR DEL PADRÓN</span>
              <div className="credential-name">Sofia Montes</div>
              <div className="credential-sub">Distrito 04 — Sector Norte (Comuna 12)</div>
            </div>
            <div className="credential-qr" aria-hidden="true">
              <svg viewBox="0 0 68 68" width="68" height="68" fill="none">
                <rect width="68" height="68" fill="#fff" />
                <rect x="4" y="4" width="20" height="20" fill="currentColor" />
                <rect x="8" y="8" width="12" height="12" fill="#fff" />
                <rect x="10" y="10" width="8" height="8" fill="currentColor" />
                <rect x="44" y="4" width="20" height="20" fill="currentColor" />
                <rect x="48" y="8" width="12" height="12" fill="#fff" />
                <rect x="50" y="10" width="8" height="8" fill="currentColor" />
                <rect x="4" y="44" width="20" height="20" fill="currentColor" />
                <rect x="8" y="48" width="12" height="12" fill="#fff" />
                <rect x="10" y="50" width="8" height="8" fill="currentColor" />
                <rect x="28" y="6" width="6" height="20" fill="currentColor" />
                <rect x="36" y="14" width="4" height="8" fill="currentColor" />
                <rect x="28" y="26" width="12" height="6" fill="currentColor" />
                <rect x="44" y="28" width="8" height="8" fill="currentColor" />
                <rect x="28" y="44" width="8" height="8" fill="currentColor" />
                <rect x="40" y="42" width="6" height="14" fill="currentColor" />
                <rect x="52" y="44" width="12" height="6" fill="currentColor" />
                <rect x="50" y="54" width="8" height="10" fill="currentColor" />
              </svg>
            </div>
          </div>

          <div className="credential-details">
            <div className="detail-row">
              <span>IDENTIFICADOR DID:</span>
              <code className="detail-value">did:civic:884a92c301</code>
            </div>
            <div className="detail-row">
              <span>COMPROMISO ED25519:</span>
              <code className="detail-value">0x8a92...fb499c</code>
            </div>
            <div className="detail-row">
              <span>EXPIRACIÓN DEL CERTIFICADO:</span>
              <span className="detail-value">31 DIC 2026</span>
            </div>
          </div>
        </div>

        <div className="credential-note">
          <svg className="note-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" />
          </svg>
          <div>
            <strong>Voto secreto garantizado:</strong> tu firma es verificada por
            compromiso criptográfico sin revelar tu identidad, cédula ni filiación en
            la boleta final.
          </div>
        </div>

        <div className="credential-foot">
          <span className="spec-label">ESPECIFICACIÓN CIP-0428 V2</span>
          <button className="btn-link" onClick={() => alert("Descargando comprobante de credencial (.json / CIP-0428)...")}>
            <svg className="btn-icon-sm" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
            </svg>
            Exportar Credencial
          </button>
        </div>
      </div>
    </section>
  );
}
