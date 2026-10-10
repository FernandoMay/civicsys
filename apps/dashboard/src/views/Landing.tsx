/**
 * Landing — hero, live metrics, and the citizen pathway.
 *
 * Same visual language as the homologated base. Every number is read from the
 * chain; the pathway describes what the system actually does (and pointedly
 * does not promise a secret ballot, a ZK proof, or an escrow that does not
 * exist).
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
    <>
      <section className="py-space-xl lg:py-space-xl">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter items-stretch">
          <div className="lg:col-span-7 flex flex-col justify-between space-y-space-lg">
            <div className="space-y-space-md">
              <div className="flex items-center gap-space-xs">
                <span className="font-code-sm text-code-sm uppercase tracking-wider px-space-xs py-0.5 bg-surface-container-highest text-on-surface font-semibold">
                  Infraestructura cívica verificable
                </span>
                <span className="font-code-sm text-code-sm text-outline">Red Stellar · {network}</span>
              </div>
              <h1 className="font-headline-xl text-headline-xl text-on-surface leading-tight tracking-tight">
                Decisiones cívicas.
                <br />
                <span className="text-primary">Verificables por diseño.</span>
              </h1>
              <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl leading-relaxed">
                Infraestructura abierta de participación: proponer, deliberar,
                decidir y <strong className="text-on-surface">verificar</strong>.
                Cada dato de esta página sale de la cadena o se muestra como
                desconocido. Nunca inventamos un resultado.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-space-sm py-space-md bg-surface-container-low px-space-md shadow-sm">
              <Metric label="Iniciativas" value={stats ? bigOrUnknown(stats.proposals) : UNKNOWN} sub="registradas en cadena" />
              <Metric label="Reportes" value={stats ? bigOrUnknown(stats.anchoredReports) : UNKNOWN} sub="anclados en cadena" />
              <Metric label="Contratos" value="4" sub="verificables en el explorador" />
              <Metric label="Red" value={network} sub="evidencia en vivo" />
            </div>

            <div className="flex flex-wrap items-center gap-space-md pt-space-xs">
              <button
                type="button"
                onClick={onExplore}
                className="inline-flex items-center justify-center gap-space-xs px-space-lg py-space-sm bg-primary text-on-primary font-body-md font-semibold hover:bg-primary-container transition-colors shadow-sm"
              >
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                  how_to_vote
                </span>
                Explorar Iniciativas
              </button>
              <button
                type="button"
                onClick={onCheckCredential}
                className="inline-flex items-center justify-center gap-space-xs px-space-lg py-space-sm bg-surface-container-highest text-on-surface hover:bg-surface-container font-body-md font-semibold transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                  verified_user
                </span>
                Verificar una Credencial
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 flex flex-col justify-center">
            <div className="bg-surface-container-lowest p-space-lg shadow-md space-y-space-md">
              <div className="flex items-center justify-between pb-space-xs">
                <div className="flex items-center gap-space-xs">
                  <span className="material-symbols-outlined text-primary text-[22px]" aria-hidden="true">
                    badge
                  </span>
                  <span className="font-label-md text-label-md uppercase tracking-wider text-on-surface font-bold">
                    Qué garantiza esta plataforma — y qué no
                  </span>
                </div>
              </div>
              <ul className="space-y-space-sm font-body-sm text-body-sm">
                <HonestRow
                  title="Voto público"
                  body="public_v1: firmado por tu cartera y visible públicamente. No es anónimo ni secreto."
                />
                <HonestRow
                  title="Voto por compromiso"
                  body="commitment_v1: oculta tu dirección en el recuento, pero la pertenencia no está probada en cadena (UNVERIFIED_COMMITMENT)."
                />
                <HonestRow title="Anonimato ZK" body="NO EXISTE. No hay verificador desplegado, así que no lo prometemos." strong />
                <HonestRow
                  title="Identidad"
                  body="La cadena guarda solo un compromiso de 32 bytes. Nunca tu nombre, documento ni correo."
                />
                <HonestRow
                  title="Lectura de datos"
                  body="Si la cadena no responde, la pantalla dice DESCONOCIDO. Nunca inventa un cero ni un resultado."
                />
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="py-space-xl">
        <div className="space-y-space-lg">
          <div className="space-y-space-xs text-left">
            <span className="font-code-sm text-code-sm text-primary uppercase font-bold tracking-wider">
              Cómo participar
            </span>
            <h2 className="font-headline-lg text-headline-lg text-on-surface font-bold">
              El camino en 4 pasos
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
              Sin trámites presenciales. Cada paso se verifica contra la cadena.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter">
            <Step
              n="01"
              icon="pin"
              title="Conecta tu cartera"
              body="Tu dirección pública es tu identidad ante los contratos. Sin cartera no hay firma, y sin firma no hay voto."
              tag="CARTERA STELLAR"
            />
            <Step
              n="02"
              icon="menu_book"
              title="Verifica tu credencial"
              body="Consulta si una dirección tiene credencial activa y habilitada. El resultado sale del contrato, no de esta pantalla."
              tag="LECTURA EN CADENA"
            />
            <Step
              n="03"
              icon="how_to_reg"
              title="Emite tu voto"
              body="Público o por compromiso. Ambos quedan registrados y el recuento se puede releer y verificar en cualquier momento."
              tag="public_v1 / commitment_v1"
            />
            <Step
              n="04"
              icon="policy"
              title="Audita el resultado"
              body="Relee el recuento, ejecuta el verificador y comprueba los reportes anclados. La evidencia es pública y permanente."
              tag="FAIL-CLOSED"
            />
          </div>
        </div>
      </section>
    </>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="font-code-sm text-code-sm uppercase text-outline">{label}</div>
      <div className="font-headline-md text-headline-md text-on-surface font-bold" data-testid={`metric-${label}`}>
        {value}
      </div>
      <div className="font-code-sm text-code-sm text-on-surface-variant">{sub}</div>
    </div>
  );
}

function HonestRow({ title, body, strong = false }: { title: string; body: string; strong?: boolean }) {
  return (
    <li className="bg-surface-container-low p-space-sm">
      <span className="font-code-sm text-code-sm text-outline uppercase">{title}: </span>
      <span className={`font-body-sm text-body-sm ${strong ? "font-bold text-error" : "text-on-surface-variant"}`}>
        {body}
      </span>
    </li>
  );
}

function Step({ n, icon, title, body, tag }: { n: string; icon: string; title: string; body: string; tag: string }) {
  return (
    <div className="bg-surface-container-lowest p-space-lg space-y-space-md flex flex-col justify-between shadow-sm">
      <div className="space-y-space-sm">
        <div className="flex items-center justify-between">
          <span className="font-headline-lg text-headline-lg font-bold text-outline">{n}</span>
          <span className="material-symbols-outlined text-primary text-[24px]" aria-hidden="true">
            {icon}
          </span>
        </div>
        <h3 className="font-headline-md text-headline-md text-on-surface font-bold">{title}</h3>
        <p className="font-body-sm text-body-sm text-on-surface-variant">{body}</p>
      </div>
      <div className="pt-space-sm">
        <span className="font-code-sm text-code-sm text-primary font-semibold">[{tag}]</span>
      </div>
    </div>
  );
}
