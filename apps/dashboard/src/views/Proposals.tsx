import { ProposalView, PROPOSAL_STATUS_LABEL } from "@civicsys/sdk";

interface ProposalCardProps {
  proposal: ProposalView;
  status: number;
  index: number;
}

const STATUS_BADGE: Record<number, { label: string; variant: string }> = {
  0: { label: "Programada", variant: "outline" },
  1: { label: "En Votación", variant: "primary" },
  2: { label: "Cerrada", variant: "outline" },
  3: { label: "Cancelada", variant: "warn" },
};

export default function Proposals({ proposals }: { proposals: ProposalView[] }) {
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
          <button className="filter-btn filter-active">TODAS (3)</button>
          <button className="filter-btn">MOVILIDAD</button>
          <button className="filter-btn">ENERGÍA</button>
        </div>
      </div>

      <div className="proposals-grid">
        {proposals.map((p, i) => (
          <ProposalCard key={p.id.toString()} proposal={p} status={statusForDemo(i)} index={i} />
        ))}
      </div>
    </section>
  );
}

function statusForDemo(index: number): number {
  // Demo estática: 0,1,2 para las 3 tarjetas
  return index % 3;
}

function ProposalCard({ proposal, status, index }: ProposalCardProps) {
  const badge = STATUS_BADGE[status] ?? STATUS_BADGE[0]!;
  const daysLeft = daysLeftForDemo(index);
  const image = imageForDemo(index);
  const idLabel = `CIV-2025-${String(index + 1).padStart(2, "0")}`;

  return (
    <article className="proposal-card">
      <div className="proposal-media">
        <img className="proposal-img" src={image} alt={`Ilustración iniciativa ${idLabel}`} loading="lazy" />
        <span className={`proposal-status-badge badge-${badge.variant}`}>
          [✓ {badge.label.toUpperCase()} · {daysLeft} DÍAS RESTANTES]
        </span>
        <span className="proposal-id-badge">ID: {idLabel}</span>
      </div>

      <div className="proposal-body">
        <div className="proposal-head">
          <div className="proposal-meta-top">
            <span className="proposal-district">DISTRITO CENTRAL & NORTE</span>
            <span className="proposal-budget-label">PRESUPUESTO ASIGNADO</span>
          </div>
          <h3 className="proposal-title">{proposalTitleForDemo(index)}</h3>
          <p className="proposal-desc">{proposalDescForDemo(index)}</p>
        </div>

        <div className="proposal-budget-row">
          <span className="budget-key">PRESUPUESTO:</span>
          <span className="budget-value">{budgetForDemo(index)}</span>
        </div>
        <div className="proposal-budget-row">
          <span className="budget-key">CONTRATISTA VERIFICADO:</span>
          <span className="budget-value budget-medium">{contractorForDemo(index)}</span>
        </div>

        <div className="proposal-participation">
          <div className="participation-head">
            <span className="participation-label">Participación Ciudadana:</span>
            <span className="participation-value">{participationForDemo(index)}</span>
          </div>
          <div className="participation-bar">
            <div className="participation-fill" style={{ width: participationPctForDemo(index) }} />
          </div>
          <div className="participation-foot">
            <span>Mínimo requerido: {minVotesForDemo(index)} votos</span>
            <span className="participation-status">[{quorumLabelForDemo(index).toUpperCase()}]</span>
          </div>
        </div>
      </div>

      <div className="proposal-action">
        <button className="btn btn-primary proposal-cta" onClick={() => alert(`Abriendo boleta cifrada para: ${proposalTitleForDemo(index)}`)}>
          <svg className="btn-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
          Apoyar e Inspeccionar
        </button>
      </div>
    </article>
  );
}

function daysLeftForDemo(index: number): number {
  return [4, 2, 0][index] ?? 0;
}

function imageForDemo(index: number): string {
  return [
    "https://lh3.googleusercontent.com/aida-public/AB6AXuA_xLWpp3Q8iRYtyCRueA3z_eGMqO3bf1uZA_7HiOkLCK1e1h8I1ZSqh0yLXNTdHbzWZSUUXMBPoMtFSokccGMChT9TDDhqiDoDp4LFZmJLzs9gKmrwqeTzEwKrTY4tXluZQBNds0SZsX5ZDR_ACRGpTKXHUdn4HP2YiducE0U6pb4q83kaL4yHVakrxAAWdtbToBS1J2WIuX5ChZ9011CrwEr7ehHDwnPk1exZdxv0UbrCANM1a2uA",
    "https://lh3.googleusercontent.com/aida-public/AB6AXuDQEfnvGMNy-pAN5GCtXLg5FvnjrC5RFHViRszK1d-VUYzn_Nvm-V4Oqn_ZNcKylSVBbcrZzqL8-o1dYdR_lfb7Wr39dBnO4NDx6ZDg4ZJUrerY-Vw728t7BzIg6ckN1aiol_EVhI1V4lCeZv7JQyUev03b01Yedm9ycE8VtMcHd3MzFGqGdNdg32NtddGHCywvEPfxcn46Y9jc9DA8cDRKVKnNk9lArfddH7Zgiz_DbHU0-m2BvRJ3",
    "https://lh3.googleusercontent.com/aida-public/AB6AXuAW1luK55W7sNX_CrXrz4DussamDz2SCWVsnA4EPALt5C7tXpHond6QNklv96r7SM-t8YFEMummHvmL6Vyb8okeIS3Z7awL80L0_YFy8Dv8bWz4J0gq2xycZSLKKmIN0B98JmUYXD4WIqfiHrUJQRAV7qHgf9qnNIiN-I1QocZzOZIBQ3Z6bQS1gtlUlAvbd2bIDFgFBaP2WF91C7MtT_-DpwcGDpdbit-ddbGLtaWKz7WC8JB7ZvRw",
  ][index] ?? "";
}

function proposalTitleForDemo(index: number): string {
  return [
    "Corredor de Movilidad Eléctrica y Estaciones Solares (Av. San Juan)",
    "Red de Energía Solar para el Centro de Salud Santa Teresa y 3 Escuelas",
    "Revitalización Participativa del Parque Central y Drenaje Sostenible",
  ][index] ?? "";
}

function proposalDescForDemo(index: number): string {
  return [
    "Renovación total de 18 km de vía preferencial para transporte público eléctrico no contaminante con paradas intermodales y pérgolas fotovoltaicas comunitarias.",
    "Instalación comunitaria de 420 paneles fotovoltaicos y banco de baterías para garantizar autonomía energética médica durante cortes e inyectar excedente vecinal.",
    "Diseño de bioretención pluvial, 240 nuevos árboles nativos y senderos permeables. El motor Hermes ha analizado 14 estudios hidrológicos y presupuestarios oficiales.",
  ][index] ?? "";
}

function budgetForDemo(index: number): string {
  return ["€44,200,000 EUR", "$185,000 USD", "$92,000 USD"][index] ?? "";
}

function contractorForDemo(index: number): string {
  return [
    "Consorcio Vía Verde S.L.",
    "Cooperativa Helios Ciudadana",
    "Evidencia auditada por Hermes (14 fuentes primarias validadas)",
  ][index] ?? "";
}

function participationForDemo(index: number): string {
  return ["3,815 vecinos (82.3% del quórum)", "1,420 vecinos (127% del quórum)", "En deliberación con Hermes"][index] ?? "";
}

function participationPctForDemo(index: number): string {
  return ["82.3%", "100%", "60%"][index] ?? "0%";
}

function minVotesForDemo(index: number): string {
  return ["3,000 votos", "1,100 votos", "pending"][index] ?? "0 votos";
}

function quorumLabelForDemo(index: number): string {
  return ["QUÓRUM CUMPLIDO", "SOBREQUÓRUM HISTÓRICO", "EN REVISIÓN"][index] ?? "";
}
