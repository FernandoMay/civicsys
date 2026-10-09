import { useState } from "react";

type BallotChoice = "for" | "against" | "abstain";

const CHOICES: { value: BallotChoice; label: string; desc: string }[] = [
  {
    value: "for",
    label: "A favor de la iniciativa",
    desc: "Apoyo la ejecución del presupuesto del 35% ($4,200,000 USD) y el inicio de obra licitada en Av. San Juan.",
  },
  {
    value: "against",
    label: "En contra de la iniciativa",
    desc: "Considero que existen otras prioridades de inversión en el distrito o desacuerdo con el trazo.",
  },
  {
    value: "abstain",
    label: "Abstención formal",
    desc: "Sumar al quórum de validez sin inclinar la decisión hacia la aprobación o rechazo.",
  },
];

export default function Vote() {
  const [choice, setChoice] = useState<BallotChoice | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [receipt, setReceipt] = useState<{ time: string; code: string; hash: string } | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!choice) return;

    const now = new Date();
    const code = `#CP-2026-${String(Math.floor(1000 + Math.random() * 9000))}-${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`;
    const hash = "0x" + Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

    setReceipt({ time: now.toLocaleTimeString(), code, hash });
    setSubmitted(true);
  };

  return (
    <section className="vote-section">
      <div className="vote-card">
        <div className="vote-head">
          <div className="vote-head-left">
            <span className="vote-dot" aria-hidden="true" />
            <h2 className="vote-title">Terminal de Emisión de Voto</h2>
          </div>
          <span className="vote-spec">CIP-0104 COMPLIANT</span>
        </div>

        <div className="vote-identity">
          <div className="vote-identity-row">
            <div className="vote-identity-avatar">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
            </div>
            <div className="vote-identity-info">
              <span className="vote-identity-name">Sofia Montes</span>
              <span className="vote-identity-meta">#REG-04-8921 · D14 SAN JUAN</span>
            </div>
            <span className="vote-identity-badge">[✓ HABILITADA PARA VOTAR]</span>
          </div>
        </div>

        {!submitted ? (
          <form className="vote-form" onSubmit={handleSubmit}>
            <fieldset>
              <legend className="vote-legend">Selecciona tu decisión deliberada:</legend>

              {CHOICES.map((c) => (
                <label key={c.value} className={`vote-option ${choice === c.value ? "vote-option-selected" : ""}`}>
                  <input
                    type="radio"
                    name="ballot_choice"
                    value={c.value}
                    checked={choice === c.value}
                    onChange={(e) => setChoice(e.target.value as BallotChoice)}
                    className="vote-radio"
                  />
                  <div className="vote-option-content">
                    <span className="vote-option-label">{c.label}</span>
                    <span className="vote-option-desc">{c.desc}</span>
                  </div>
                </label>
              ))}
            </fieldset>

            <div className="vote-zk-note">
              <svg className="zk-note-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" />
              </svg>
              <p>
                <strong className="zk-note-strong">Garantía Zero-Knowledge:</strong> tu identidad
                valida tu derecho a participar, pero tu elección se disocia matemáticamente de tu
                nombre. Recibirás un comprobante digital único (<code className="zk-note-code">#CP-2026-XXXX</code>).
              </p>
            </div>

            <button type="submit" className="btn btn-primary vote-cta" disabled={!choice}>
              <svg className="btn-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 1C5.93 1 1 5.93 1 12s4.93 11 11 11 11-4.93 11-11S18.07 1 12 1zm0 19c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zM12 14c-1.93 0-3.5-1.57-3.5-3.5S10.07 7 12 7s3.5 1.57 3.5 3.5S13.93 14 12 14z" />
              </svg>
              Confirmar y Emitir Voto Verificable
              <span className="vote-cta-spec">[CIP-0104]</span>
            </button>
          </form>
        ) : (
          <div className="vote-receipt" role="status" aria-live="polite">
            <div className="receipt-head">
              <svg className="receipt-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
              <span className="receipt-title">¡VOTO ANCLADO EN EL LEDGER CON ÉXITO!</span>
            </div>
            <p className="receipt-time">Comprobante de emisión emitido a las {receipt?.time}.</p>
            <div className="receipt-code">
              <span className="receipt-label">RECIBO:</span>
              <code className="receipt-value">{receipt?.code}</code>
              <span className="receipt-hash">HASH: {receipt?.hash}</span>
            </div>
            <p className="receipt-foot">Conserva esta clave para auditar el escrutinio final.</p>

            <button
              className="btn btn-secondary"
              onClick={() => {
                setSubmitted(false);
                setReceipt(null);
                setChoice(null);
              }}
            >
              Emitir otro voto
            </button>
          </div>
        )}
      </div>

      {/* Quorum panel */}
      <div className="quorum-card">
        <div className="quorum-head">
          <div className="quorum-head-left">
            <svg className="quorum-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
            </svg>
            <h3 className="quorum-title">Monitoreo del Escrutinio</h3>
          </div>
          <span className="quorum-live">
            <span className="quorum-live-dot" aria-hidden="true" /> EN VIVO
          </span>
        </div>

        <div className="quorum-stats">
          <div className="quorum-stat">
            <span className="stat-value">3,815 vecinos</span>
            <span className="stat-label">Participación Actual</span>
          </div>
          <div className="quorum-stat">
            <span className="stat-value warn">Faltan 185 votos</span>
            <span className="stat-label">Meta de Quórum: 4,000 (82.3%)</span>
          </div>
        </div>

        <div className="quorum-bar">
          <div className="quorum-bar-track">
            <div className="quorum-bar-fill" style={{ width: "82.3%" }} />
          </div>
          <div className="quorum-bar-labels">
            <span>0</span>
            <span>UMBRAL VÁLIDO: 4,000</span>
            <span>POTENCIAL: 5,200</span>
          </div>
        </div>

        {/* Distribution */}
        <div className="quorum-dist">
          <div className="quorum-dist-head">
            <span className="quorum-dist-label">Distribución Provisional (Escrutinio Parcial)</span>
          </div>
          <div className="quorum-dist-bar">
            <div className="quorum-dist-seg seg-for" style={{ width: "78.4%" }} title="A favor: 78.4%" />
            <div className="quorum-dist-seg seg-against" style={{ width: "15.6%" }} title="En contra: 15.6%" />
            <div className="quorum-dist-seg seg-abstain" style={{ width: "6.0%" }} title="Abstención: 6.0%" />
          </div>
          <div className="quorum-dist-legend">
            <div className="legend-item">
              <span className="legend-value">78.4%</span>
              <span className="legend-label">A favor (2,991)</span>
            </div>
            <div className="legend-item">
              <span className="legend-value against">15.6%</span>
              <span className="legend-label">En contra (595)</span>
            </div>
            <div className="legend-item">
              <span className="legend-value gray">6.0%</span>
              <span className="legend-label">Abstención (229)</span>
            </div>
          </div>
        </div>

        <div className="quorum-note">
          <svg className="quorum-note-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2L2 12h3v8H2v2h2v1H2c-1.1 0-2 .9-2 2v1c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-1c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-3v-8h3V2zm4.5 6c-.83 0-1.5-.67-1.5-1.5S15.67 5 16.5 5s1.5.67 1.5 1.5S17.33 8 16.5 8zm0 10c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM8.5 8c.83 0 1.5.67 1.5 1.5S9.33 11 8.5 11 7 10.33 7 9.5 7.67 8 8.5 8zm0 10c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5.67-1.5 1.5-1.5z" />
          </svg>
          <div>
            <strong className="quorum-note-strong">Garantía Post-Voto y Ejecución de Obra:</strong>
            si la opción “A favor” consolida la mayoría absoluta y el quórum supera el 85%,
            el contrato inteligente de desembolso inicia automáticamente la licitación pública
            sin intermediación burocrática discrecional.
          </div>
        </div>
      </div>
    </section>
  );
}
