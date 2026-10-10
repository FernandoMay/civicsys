/**
 * Guarantees — an honest legend of the states this app can actually show.
 *
 * Documentation rendered as UI, not a claim about any particular record. Every
 * badge corresponds to a real outcome of the SDK verifier (RFC §6).
 */

import { deployment } from "../lib/chain.js";

const BADGES = [
  {
    label: "[✓ VERIFICADO]",
    icon: "check_circle",
    title: "Consistencia probada",
    desc: "Todas las reglas deterministas del recuento se cumplen: total = suma de opciones = votos públicos + de compromiso.",
    labelCls: "text-primary",
    iconCls: "text-primary",
  },
  {
    label: "[⚠ INCONSISTENTE]",
    icon: "warning",
    title: "El dato no cuadra",
    desc: "El recuento leído viola al menos una regla. Puede indicar corrupción o manipulación: el verificador lo señala en vez de ocultarlo.",
    labelCls: "text-tertiary-container",
    iconCls: "text-tertiary-container",
  },
  {
    label: "[? DESCONOCIDO]",
    icon: "help",
    title: "Sin dato verificable",
    desc: "La cadena no respondió o la propiedad no es demostrable todavía. Se muestra DESCONOCIDO; nunca se rellena con un valor por defecto.",
    labelCls: "text-outline",
    iconCls: "text-outline",
  },
  {
    label: "[× FALLIDO]",
    icon: "cancel",
    title: "Transacción rechazada",
    desc: "El propio contrato rechazó la operación: ventana cerrada, voto repetido o credencial no habilitada.",
    labelCls: "text-error",
    iconCls: "text-error",
  },
];

export default function Guarantees() {
  const explorerBase = `https://stellar.expert/explorer/${deployment.network}`;
  const contractHref = `${explorerBase}/contract/${deployment.contracts["brujula-vote"]!.contract_id}`;

  return (
    <section className="py-space-xl">
      <div className="bg-surface-container-lowest p-space-lg shadow-sm space-y-space-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md pb-space-sm">
          <div className="space-y-space-xs">
            <div className="flex items-center gap-space-xs">
              <span className="material-symbols-outlined text-primary text-[22px]" aria-hidden="true">
                gavel
              </span>
              <span className="font-label-md text-label-md uppercase tracking-wider text-on-surface font-bold">
                Garantía de verificación fail-closed
              </span>
            </div>
            <p className="font-body-md text-body-md text-on-surface-variant max-w-3xl">
              Ningún registro se da por válido por presunción. El sistema solo
              afirma lo que puede probar y declara <code>DESCONOCIDO</code> en el
              resto de casos. Estos son los únicos cuatro estados que la interfaz
              puede mostrar.
            </p>
          </div>
          <a
            className="inline-flex items-center gap-space-xs px-space-md py-space-sm bg-surface-container-highest text-on-surface font-body-sm font-semibold hover:bg-surface-container transition-colors shrink-0"
            href={contractHref}
            target="_blank"
            rel="noreferrer"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              open_in_new
            </span>
            Ir al verificador público
          </a>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-gutter">
          {BADGES.map((b) => (
            <div key={b.label} className="p-space-md bg-surface-container-low space-y-space-xs">
              <div className="flex items-center justify-between">
                <span className={`font-code-sm text-code-sm font-bold ${b.labelCls}`}>{b.label}</span>
                <span className={`material-symbols-outlined text-[20px] ${b.iconCls}`} aria-hidden="true">
                  {b.icon}
                </span>
              </div>
              <div className="font-body-md text-body-md font-semibold text-on-surface">{b.title}</div>
              <p className="font-body-sm text-body-sm text-on-surface-variant">{b.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
