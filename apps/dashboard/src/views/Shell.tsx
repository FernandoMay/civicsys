/**
 * App shell: header, ledger ticker, footer.
 *
 * Visual language taken from the homologated base (Tailwind utilities over the
 * design tokens). Content rules are unchanged: every figure is read from the
 * chain or rendered DESCONOCIDO. In particular the header shows the live ledger
 * sequence and the real network — never a hardcoded block number, and never
 * "MAINNET" while the deployment record says testnet.
 */

import { deployment } from "../lib/chain.js";
import { UNKNOWN } from "../lib/format.js";
import { useWallet } from "../lib/wallet.js";

export type Route = { name: "home" } | { name: "detail"; id: bigint };

export default function Shell({
  route,
  ledger,
  onNavigate,
  onCheckCredential,
  children,
}: {
  route: Route;
  ledger: number | null;
  onNavigate: (route: Route) => void;
  onCheckCredential: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background font-body-md text-body-md text-on-surface antialiased">
      <Header route={route} ledger={ledger} onNavigate={onNavigate} onCheckCredential={onCheckCredential} />
      <main className="w-full pt-16">
        <Ticker ledger={ledger} />
        <div className="max-w-[1360px] mx-auto px-margin-sm lg:px-margin">{children}</div>
      </main>
      <Footer />
    </div>
  );
}

function Header({
  route,
  ledger,
  onNavigate,
  onCheckCredential,
}: {
  route: Route;
  ledger: number | null;
  onNavigate: (route: Route) => void;
  onCheckCredential: () => void;
}) {
  const { address, connecting, connect, disconnect } = useWallet();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-surface/90 backdrop-blur-xl border-b border-surface-container-highest">
      <div className="h-16 max-w-[1360px] mx-auto px-margin-sm lg:px-margin flex items-center justify-between">
        <div className="flex items-center gap-space-lg">
          <button
            type="button"
            onClick={() => onNavigate({ name: "home" })}
            className="flex items-center gap-space-sm focus:outline-none"
            aria-label="Brújula Cívica — inicio"
          >
            <img alt="Brújula Cívica" className="h-8 w-auto object-contain" src="/assets/logo-symbol.svg" />
            <span className="flex flex-col text-left">
              <span className="font-label-md text-label-md uppercase tracking-wider text-on-surface font-semibold">
                Brújula Cívica
              </span>
              <span className="font-code-sm text-code-sm text-primary uppercase">
                Registro verificable
              </span>
            </span>
          </button>
          <div className="h-6 w-px bg-surface-container-highest hidden md:block" />
          <nav className="hidden lg:flex items-center gap-space-lg" aria-label="Principal">
            <NavLink active={route.name === "home"} onClick={() => onNavigate({ name: "home" })}>
              Iniciativas
            </NavLink>
            <button
              type="button"
              onClick={onCheckCredential}
              className="font-body-sm text-body-sm text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Mi Credencial
            </button>
            <NavLink active={false} onClick={() => scrollToId("reportes")}>
              Evidencia
            </NavLink>
            <NavLink active={false} onClick={() => scrollToId("votar")}>
              Votar
            </NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-space-md">
          <div className="hidden sm:flex items-center px-space-sm py-space-xs bg-surface-container-lowest border border-primary-container text-primary-container font-code-sm text-code-sm">
            <span className="font-semibold">
              {ledger === null ? `[? LEDGER ${UNKNOWN}]` : `[✓ LEDGER ACTIVO #${ledger.toLocaleString("es")}]`}
            </span>
          </div>
          {address ? (
            <div className="flex items-center gap-space-xs">
              <span
                className="hidden xl:block font-code-sm text-code-sm text-on-surface-variant brujula-break max-w-[180px]"
                title={address}
              >
                {address.slice(0, 6)}…{address.slice(-4)}
              </span>
              <button
                type="button"
                onClick={() => void disconnect()}
                className="px-space-sm py-space-xs bg-surface-container-highest text-on-surface font-body-sm font-semibold hover:bg-surface-container transition-colors"
              >
                Desconectar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void connect().catch(() => {})}
              disabled={connecting}
              className="px-space-sm py-space-xs bg-primary text-on-primary font-body-sm font-semibold hover:bg-primary-container transition-colors disabled:opacity-50"
            >
              {connecting ? "Conectando…" : "Conectar cartera"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function NavLink({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`font-body-sm text-body-sm transition-colors ${
        active ? "text-primary font-semibold" : "text-on-surface-variant hover:text-on-surface"
      }`}
    >
      {children}
    </button>
  );
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

function Ticker({ ledger }: { ledger: number | null }) {
  return (
    <div className="w-full bg-surface-container-high py-space-xs">
      <div className="max-w-[1360px] mx-auto px-margin-sm lg:px-margin flex flex-wrap items-center justify-between gap-space-sm font-code-sm text-code-sm">
        <div className="flex items-center gap-space-md">
          <span className="flex items-center gap-space-xs text-primary font-semibold">
            <span className="w-2 h-2 rounded-full bg-primary brujula-pulse" aria-hidden="true" />
            LEDGER CÍVICO · STELLAR {deployment.network.toUpperCase()}
          </span>
          <span className="text-on-surface-variant hidden sm:inline">
            {ledger === null ? `BLOQUE ${UNKNOWN}` : `BLOQUE #${ledger.toLocaleString("es")}`}
          </span>
        </div>
        <div className="flex items-center gap-space-lg text-on-surface-variant">
          <span className="hidden md:inline">MODO public_v1 · TRANSPARENTE</span>
          <span className="hidden sm:inline">SIN ANONIMATO ZK</span>
        </div>
      </div>
    </div>
  );
}

function Footer() {
  const base = `https://stellar.expert/explorer/${deployment.network}`;
  return (
    <footer className="w-full bg-surface-container-low border-t border-surface-container-highest mt-space-xl">
      <div className="max-w-[1360px] mx-auto px-margin-sm lg:px-margin py-space-xl">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-gutter pb-space-lg border-b border-surface-container-highest">
          <div className="space-y-space-sm md:col-span-1">
            <div className="flex items-center gap-space-xs">
              <img alt="Brújula Cívica" className="h-6 w-auto object-contain" src="/assets/logo-symbol.svg" />
              <span className="font-label-md text-label-md uppercase font-bold text-on-surface">
                Brújula Cívica
              </span>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Infraestructura abierta de participación verificable. Todo dato
              mostrado sale de la cadena o se marca como desconocido.
            </p>
          </div>
          <div className="space-y-space-xs">
            <span className="font-code-sm text-code-sm uppercase text-outline font-semibold block">
              Contratos en {deployment.network}
            </span>
            <ul className="space-y-space-xs font-body-sm text-body-sm">
              {Object.entries(deployment.contracts).map(([name, c]) => (
                <li key={name}>
                  <a
                    className="text-primary hover:underline font-code-sm text-code-sm brujula-break"
                    href={`${base}/contract/${c.contract_id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {name} ↗
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-space-xs">
            <span className="font-code-sm text-code-sm uppercase text-outline font-semibold block">
              Garantías
            </span>
            <ul className="space-y-space-xs font-body-sm text-body-sm text-on-surface-variant">
              <li>Voto público, no anónimo</li>
              <li>Sin anonimato ZK desplegado</li>
              <li>Lo no leído se muestra {UNKNOWN}</li>
            </ul>
          </div>
          <div className="space-y-space-xs">
            <span className="font-code-sm text-code-sm uppercase text-outline font-semibold block">
              Red
            </span>
            <div className="p-space-sm bg-surface-container-lowest border border-surface-container-highest space-y-space-xs">
              <div className="flex items-center justify-between font-code-sm text-code-sm">
                <span className="text-outline">RED:</span>
                <span className="text-on-surface font-semibold">STELLAR {deployment.network.toUpperCase()}</span>
              </div>
              <div className="flex items-center justify-between font-code-sm text-code-sm">
                <span className="text-outline">ORIGEN:</span>
                <span className="text-on-surface font-semibold brujula-break">
                  {deployment.source_account.slice(0, 6)}…{deployment.source_account.slice(-4)}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="pt-space-md flex flex-col md:flex-row items-center justify-between gap-space-sm font-code-sm text-code-sm text-outline">
          <span>BRÚJULA CÍVICA · INFRAESTRUCTURA VERIFICABLE EN TESTNET</span>
          <span>DATO NO LEÍDO = {UNKNOWN}</span>
        </div>
      </div>
    </footer>
  );
}
