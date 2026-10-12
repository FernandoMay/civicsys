/**
 * Estado de la demostración — qué se puede comprobar hoy y qué no.
 *
 * A guided demo has to be honest about its own limits, or the presenter ends
 * up improvising apologies in front of the audience. This panel states, up
 * front and with no decoration, which parts of the product are verifiable
 * right now and which are blocked on something outside the browser.
 *
 * Nothing here is a status light: every "verifiable" line is backed by a live
 * read the page already did, and every blocked line names the exact thing
 * that is missing. When those blockers are cleared, the lines go away rather
 * than lying in the other direction.
 */

import type { Read } from "@brugulacivica/sdk";

import { usePublishCapability } from "../lib/publishCapability.js";

export type DemoDependency = {
  /** What the audience would try to do. */
  capability: string;
  /** What the current build can actually do about it. */
  state: "verifiable" | "needs_config" | "unavailable";
  /** The reason, stated plainly. Never a vague "coming soon". */
  reason: string;
};

type Props = {
  /** Proposals read from the chain on this page load, or null before it lands. */
  proposalCount: Read<bigint> | null;
  /** Reports read from the accountability contract, or null before it lands. */
  reportCount: Read<bigint> | null;
  /** Live ledger sequence, or null when the RPC could not be reached. */
  ledger: number | null;
  /** How many of the read proposals carry retrievable content. */
  verifiableProposals: number;
  /** How many the chain records but whose content cannot be shown. */
  unverifiableProposals: number;
};

const STATE_STYLE = {
  verifiable: { mark: "[✓ VERIFICABLE]", cls: "text-primary" },
  needs_config: { mark: "[! REQUIERE CONFIG]", cls: "text-tertiary" },
  unavailable: { mark: "[✕ NO DISPONIBLE]", cls: "text-error" },
} as const;

export default function DemoStatus({
  proposalCount,
  reportCount,
  ledger,
  verifiableProposals,
  unverifiableProposals,
}: Props) {
  const publishCapability = usePublishCapability();
  const chain: DemoDependency =
    ledger === null
      ? {
          capability: "Leer la cadena Stellar testnet",
          state: "unavailable",
          reason:
            "El RPC público no respondió en esta carga. Sin esa lectura ninguna pantalla puede afirmar un dato on-chain.",
        }
      : {
          capability: "Leer la cadena Stellar testnet",
          state: "verifiable",
          reason: `Ledger ${ledger.toLocaleString("es-ES")} leído en vivo y contrastable en el explorador.`,
        };

  const records: DemoDependency = {
    capability: "Registros, escrutinio y rendición de cuentas",
    state:
      proposalCount?.status === "ok" && reportCount?.status === "ok"
        ? "verifiable"
        : "needs_config",
    reason:
      proposalCount?.status === "ok" && reportCount?.status === "ok"
        ? `${proposalCount.value.toString()} iniciativas y ${reportCount.value.toString()} reportes anclados, todos con su hash y su enlace al explorador.`
        : "No se pudo leer el total de iniciativas o de reportes; esos contadores se muestran como DESCONOCIDO en lugar de cero.",
  };

  // Read from the function rather than asserted here: the secret being set and
  // the key being allowed to pin are two different failures with two different
  // fixes, and only the function knows which one it is.
  const publish: DemoDependency = (() => {
    const capability = "Publicar una iniciativa nueva";
    if (publishCapability.status === "loading") {
      return {
        capability,
        state: "needs_config" as const,
        reason: "Comprobando si el servicio de publicación está disponible…",
      };
    }
    if (publishCapability.status === "unknown") {
      return {
        capability,
        state: "needs_config" as const,
        reason: publishCapability.reason,
      };
    }
    // `ready === null` means the service itself could not tell. Showing that as
    // VERIFICABLE would be a claim nobody verified; showing it as blocked would
    // be a claim nobody tested. It is reported as exactly what it is.
    if (publishCapability.ready === true) {
      return {
        capability,
        state: "verifiable" as const,
        reason:
          "El servicio de publicación responde y acepta el token. Crear una iniciativa escribe el contenido en IPFS y ancla sus hashes en Stellar con una firma de tu cartera.",
      };
    }
    if (publishCapability.ready === null) {
      return { capability, state: "needs_config" as const, reason: publishCapability.reason };
    }
    return {
      capability,
      state: "needs_config" as const,
      reason: publishCapability.reason,
    };
  })();

  const content: DemoDependency =
    verifiableProposals > 0
      ? {
          capability: "Leer el contenido de las iniciativas",
          state: "verifiable",
          reason: `${verifiableProposals} iniciativa(s) se recuperan por su CID y sus hashes coinciden con los anclados en Stellar.`,
        }
      : {
          capability: "Leer el contenido de las iniciativas",
          state: "unavailable",
          reason:
            unverifiableProposals > 0
              ? `Las ${unverifiableProposals} iniciativas registradas anclan un CID cuyo objeto no es proposal-content@1, así que el detalle muestra MISMATCH. La cadena guarda los hashes, no el texto.`
              : "Todavía no hay iniciativas registradas cuyo contenido se pueda recuperar.",
        };

  const anonymity: DemoDependency = {
    capability: "Anonimato criptográfico en el voto",
    state: "unavailable",
    reason:
      "No hay verificador ZK desplegado. El modo commitment_v1 oculta la dirección del recuento pero no prueba pertenencia, y se marca UNVERIFIED_COMMITMENT.",
  };

  const items = [chain, records, publish, content, anonymity];

  return (
    <section className="py-space-lg" id="estado-demo" aria-labelledby="demo-status-heading">
      <div className="p-space-lg bg-surface-container-low space-y-space-md">
        <div className="space-y-space-xs">
          <h2 id="demo-status-heading" className="font-headline-md text-headline-md text-on-surface font-bold">
            Estado de esta demostración
          </h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant max-w-3xl">
            Cada línea dice qué se puede comprobar ahora mismo con lo que hay
            desplegado. Lo que depende de una configuración o de una
            credencial externa se nombra en vez de disimularse.
          </p>
        </div>

        <ul className="space-y-space-sm">
          {items.map((item) => {
            const style = STATE_STYLE[item.state];
            return (
              <li key={item.capability} className="flex flex-col sm:flex-row gap-space-xs sm:gap-space-sm">
                <span className={`font-code-sm text-code-sm font-bold shrink-0 ${style.cls}`}>
                  {style.mark}
                </span>
                <div className="space-y-space-xs">
                  <span className="font-body-md text-body-md text-on-surface font-semibold block">
                    {item.capability}
                  </span>
                  <span className="font-body-sm text-body-sm text-on-surface-variant block">
                    {item.reason}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="font-code-sm text-code-sm text-outline">
          Con una wallet de testnet con credencial emitida puedes recorrer el
          flujo completo de voto: elegir, firmar, recibir el hash y releer el
          recuento. El estado de la publicación aparece arriba, leído del propio
          servicio.
        </p>
      </div>
    </section>
  );
}
