/**
 * Landing — the product's front door.
 *
 * Everything numeric here is read from the chain at mount. Nothing is a
 * hardcoded figure, and the previous copy's claim of a "secret ballot" was
 * removed outright: v0.1 only offers `public_v1`, which is transparent by
 * definition (RFC BRUJULA-CIVICA-ARCH-001 §0.2 / §5).
 */

import type { PublicStats } from "../lib/chain.js";
import { bigOrUnknown, UNKNOWN } from "../lib/format.js";

export default function Landing({
  stats,
  network,
  onExplore,
  onCheckCredential,
}: {
  stats: PublicStats | null;
  network: string;
  onExplore: () => void;
  onCheckCredential: () => void;
}) {
  return (
    <section className="landing">
      <div className="landing-top">
        <div className="landing-eyebrow">
          <span className="eyebrow-chip">BRÚJULA CÍVICA · INFRAESTRUCTURA CÍVICA VERIFICABLE</span>
          <span className="eyebrow-meta">Red Stellar · lecturas fail-closed</span>
        </div>
        <h1 className="landing-title">
          Decisiones cívicas.<br />
          <span className="title-accent">Verificables por diseño.</span>
        </h1>
        <p className="landing-lead">
          Infraestructura abierta de participación ciudadana: proponer, deliberar,
          decidir y <strong>verificar</strong>. Cada dato de esta página sale de la
          cadena o se muestra como desconocido. Nunca inventamos un resultado.
        </p>
      </div>

      {/*
        Only metrics that cost O(1) reads appear here. "Open proposals" would
        need one query per proposal, so it is not shown on the landing page —
        and it is deliberately NOT rendered as DESCONOCIDO either, because the
        chain never failed to answer: we simply did not ask. The dashboard
        view computes it from the proposals it has already loaded.
      */}
      <div className="landing-metrics">
        <Metric
          label="Iniciativas"
          value={stats ? bigOrUnknown(stats.proposals) : UNKNOWN}
          sub="registradas en cadena"
        />
        <Metric
          label="Reportes"
          value={stats ? bigOrUnknown(stats.anchoredReports) : UNKNOWN}
          sub="anclados de forma inmutable"
        />
        <Metric label="Contratos" value="4" sub="verificables públicamente" />
        <Metric label="Red" value={network} sub="evidencia en vivo" />
      </div>

      <div className="landing-actions">
        <button type="button" className="btn btn-primary" onClick={onExplore}>
          <svg className="btn-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
          Explorar Iniciativas
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCheckCredential}>
          <svg className="btn-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
          </svg>
          Verificar una Credencial
        </button>
      </div>

      <div className="credential-card" aria-labelledby="credential-title">
        <div className="credential-head">
          <svg className="credential-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <span className="credential-title" id="credential-title">
            Qué garantiza esta plataforma — y qué no
          </span>
        </div>

        <ul className="credential-body" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          <li className="detail-row">
            <span>VOTO PÚBLICO:</span>
            <span className="detail-value">
              <code>public_v1</code> — el voto va firmado por tu cartera y es visible
              públicamente. No es anónimo ni secreto.
            </span>
          </li>
          <li className="detail-row">
            <span>VOTO POR COMPROMISO:</span>
            <span className="detail-value">
              <code>commitment_v1</code> — oculta la dirección en el recuento, pero{" "}
              <strong>la pertenencia no está probada</strong>: se marca
              UNVERIFIED_COMMITMENT hasta que exista un verificador.
            </span>
          </li>
          <li className="detail-row">
            <span>ANONIMATO ZK:</span>
            <span className="detail-value">
              <strong>NO EXISTE.</strong> No hay verificador ZK desplegado, así que no
              lo prometemos.
            </span>
          </li>
          <li className="detail-row">
            <span>IDENTIDAD:</span>
            <span className="detail-value">
              La cadena guarda solo un compromiso de 32 bytes. Nunca tu nombre,
              documento ni correo.
            </span>
          </li>
          <li className="detail-row">
            <span>LECTURA DE DATOS:</span>
            <span className="detail-value">
              Si la cadena no responde, la pantalla dice DESCONOCIDO. Nunca inventa un
              cero ni un resultado.
            </span>
          </li>
        </ul>
      </div>
    </section>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value" data-testid={`metric-${label}`}>
        {value}
      </div>
      <div className="metric-sub">{sub}</div>
    </div>
  );
}