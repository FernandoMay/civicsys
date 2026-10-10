/**
 * Ballot terminal — submits real transactions to `brujula-vote`.
 *
 * Bugs fixed in this version:
 *   - `cast_public` was called WITHOUT the `choice` argument, so every ballot
 *     was malformed and would have failed on-chain;
 *   - `voter` was the literal string `"G..."`, which is not an address;
 *   - a failed transaction set no visible message: the user saw the form reset
 *     with no explanation;
 *   - the proposal id was hardcoded to `3` and the voter identity in the header
 *     was a fabricated person ("Sofia Montes / #REG-04-8921").
 *
 * Now: the proposal is chosen from the real list of open proposals, the voter is
 * the connected wallet address or `null`, and failures are rendered.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { PROPOSAL_STATUS, type Read, type VerificationResult } from "@brugulacivica/sdk";

import { fetchTally, reader, type ProposalRow } from "../lib/chain.js";
import { commitmentDisclosure, generateVoterSecret, prepareCommitmentBallot } from "../lib/commitment.js";
import { voteClient } from "../lib/contracts.js";
import { describe, useSignTransaction, useWallet } from "../lib/wallet.js";
import { UNKNOWN } from "../lib/format.js";

/** Ballot options. Index is the on-chain `choice` value; never remapped. */
const CHOICES: { value: number; label: string; desc: string }[] = [
  { value: 0, label: "A favor", desc: "Apoyo la iniciativa tal como está registrada." },
  { value: 1, label: "En contra", desc: "Rechazo la iniciativa tal como está registrada." },
  { value: 2, label: "Abstención", desc: "Cuenta para el quórum sin inclinar la decisión." },
];

export type TxPhase = "idle" | "signing" | "submitting" | "sent";

type BallotMode = "public" | "commitment";

const COMMITMENT_DOMAIN = "brujula-civica/testnet/roster";
const COMMITMENT_ATTRIBUTES = "district=00;role=citizen;cohort=commitment-demo";

type Receipt = {
  at: string;
  txHash: string;
  proposalId: bigint;
  choice: number;
  voter: string;
  mode: BallotMode;
  confirmedLedger: string;
  commitment: string | null;
  nullifier: string | null;
};

export default function Vote({
  rows,
  selected,
  onSelect,
}: {
  rows: ProposalRow[];
  selected: bigint | null;
  onSelect: (id: bigint | null) => void;
}) {
  const { address, available, connecting, connect, error: walletError } = useWallet();
  const signTransaction = useSignTransaction();

  const [choice, setChoice] = useState<number | null>(null);
  const [mode, setMode] = useState<BallotMode>("public");
  const [membershipRoot, setMembershipRoot] = useState<string | null>(null);
  const [rootRead, setRootRead] = useState<Read<string | null> | null>(null);
  const [phase, setPhase] = useState<TxPhase>("idle");
  const [txError, setTxError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [tally, setTally] = useState<Read<VerificationResult> | null>(null);
  const [tallyLoading, setTallyLoading] = useState(false);

  const openProposals = useMemo(
    () =>
      rows.filter(
        (r) => r.status.status === "ok" && r.status.value === PROPOSAL_STATUS.OPEN,
      ),
    [rows],
  );

  const reloadTally = useCallback(async (id: bigint) => {
    setTallyLoading(true);
    try {
      setTally(await fetchTally(id));
      // A commitment ballot can only be built against a published root, so the
      // mode switch depends on this read being fresh.
      const root = await reader.membershipRoot(id);
      setRootRead(root);
      setMembershipRoot(root.status === "ok" ? root.value : null);
    } finally {
      setTallyLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected === null) {
      setTally(null);
      return;
    }
    void reloadTally(selected);
  }, [selected, reloadTally]);

  // Default the selector to the first genuinely open proposal, or to whatever the
  // caller picked. Never to a hardcoded id.
  useEffect(() => {
    if (selected === null && openProposals.length > 0) {
      onSelect(openProposals[0]!.id);
    }
  }, [selected, openProposals, onSelect]);

  const reset = () => {
    setChoice(null);
    setReceipt(null);
    setTxError(null);
    setPhase("idle");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (choice === null || selected === null) return;

    // Fail closed on every precondition rather than sending a malformed tx.
    // A wallet is required in BOTH modes: a transaction needs a funded signer
    // to pay fees, and `commitment_v1` hides the address from the *tally*, not
    // from the transaction source account.
    if (!address) {
      setTxError("Conecta una cartera para emitir tu voto. Sin firma no hay voto.");
      return;
    }
    if (!signTransaction) {
      setTxError("La cartera conectada no puede firmar transacciones.");
      return;
    }

    setTxError(null);
    setPhase("signing");
    try {
      const source = address;
      const client = await voteClient(source, signTransaction);

      let commitment: string | null = null;
      let nullifier: string | null = null;
      let tx;

      if (mode === "commitment") {
        // The secret is generated locally and never leaves the browser
        // unhashed: only its derived commitment and nullifier are submitted.
        const secret = await generateVoterSecret();
        const prepared = await prepareCommitmentBallot({
          secret,
          proposalId: selected,
          choice,
          membershipRoot,
          domain: COMMITMENT_DOMAIN,
          attributes: COMMITMENT_ATTRIBUTES,
        });
        if (!prepared.ok) {
          setTxError(prepared.reason);
          setPhase("idle");
          return;
        }
        commitment = prepared.commitment;
        nullifier = prepared.nullifier;

        setPhase("submitting");
        tx = await client.cast_commitment({
          proposal_id: selected,
          choice,
          nullifier: prepared.nullifier,
          commitment: prepared.commitment,
          membership_root: prepared.membershipRoot,
          // No verifier contract exists (RFC §5, phase 4b), so this field
          // carries no proof. Downstream it is reported UNVERIFIED_COMMITMENT.
          verifier_digest: prepared.nullifier,
        });
      } else {
        setPhase("submitting");
        tx = await client.cast_public({
          proposal_id: selected,
          voter: source,
          choice,
        });
      }

      const sent = await tx.signAndSend();
      // Read the hashes from the actual RPC responses. Never synthesize one:
      // an absent hash must surface as UNKNOWN, not as a placeholder string.
      const hash = sent.sendTransactionResponse?.hash ?? "";
      const ledger = sent.getTransactionResponse?.latestLedger;

      setReceipt({
        at: new Date().toISOString(),
        txHash: hash,
        proposalId: selected,
        choice,
        voter: source,
        mode,
        confirmedLedger: ledger === undefined ? UNKNOWN : String(ledger),
        commitment,
        nullifier,
      });
      setPhase("sent");
      await reloadTally(selected);
    } catch (err) {
      setTxError(describe(err));
      setPhase("idle");
    }
  };

  return (
    <section className="py-space-xl" id="votar">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter items-start">
        <div className="lg:col-span-7 bg-surface-container-lowest p-space-lg shadow-sm">
          <div className="flex items-center justify-between pb-space-sm">
            <div className="flex items-center gap-space-xs">
              <span className="inline-block w-2.5 h-2.5 bg-primary" aria-hidden="true" />
              <h2 className="font-headline-md text-headline-md text-on-surface">Terminal de Emisión de Voto</h2>
            </div>
            <span className="font-code-sm text-code-sm text-outline">MODO {mode === "public" ? "public_v1" : "commitment_v1"}</span>
          </div>

          <div className="p-space-sm bg-surface-container-low my-space-md">
            <div className="flex items-center justify-between gap-space-sm">
              <div className="flex items-center gap-space-sm min-w-0">
                <span className="material-symbols-outlined text-primary text-[22px]" aria-hidden="true">badge</span>
                <div className="flex flex-col min-w-0">
                  <span className="font-body-sm text-body-sm font-semibold text-on-surface brujula-break" title={address ?? undefined}>
                    {address ? `${address.slice(0, 10)}…${address.slice(-6)}` : "SIN CARTERA CONECTADA"}
                  </span>
                  <span className="font-code-sm text-code-sm text-outline">
                    {address ? "Identidad tomada de tu cartera" : "Sin firma no hay voto"}
                  </span>
                </div>
              </div>
              <span className="font-code-sm text-code-sm px-2 py-1 bg-surface-container-lowest text-primary font-semibold shrink-0">
                {address ? "[✓ CONECTADA]" : "[? SIN CARTERA]"}
              </span>
            </div>
          </div>

          {available === false && (
            <p className="p-space-sm bg-surface-container-low font-body-sm text-body-sm text-on-surface-variant" role="status">
              <strong>Cartera no detectada:</strong>{" "}
              {walletError ?? "instala Freighter (u otra compatible) para poder firmar transacciones."}
            </p>
          )}

          <form className="space-y-space-sm" onSubmit={submit}>
            <fieldset>
              <legend className="font-code-sm text-code-sm text-on-surface uppercase font-semibold mb-space-xs">
                1. Elige la iniciativa abierta:
              </legend>
              {openProposals.length === 0 ? (
                <div className="flex items-center gap-space-sm p-space-md bg-surface-container-low border border-dashed border-outline">
                  <span className="font-code-sm text-code-sm font-bold text-outline">[SIN CONSULTAS ABIERTAS]</span>
                  <span className="font-body-sm text-body-sm text-on-surface-variant">
                    ninguna propuesta tiene su ventana de votación abierta ahora mismo
                  </span>
                </div>
              ) : (
                <label className="block bg-surface-container-low p-space-sm">
                  <select
                    className="w-full bg-surface p-space-sm font-code-sm text-code-sm text-on-surface outline-none focus:ring-1 focus:ring-primary"
                    value={selected === null ? "" : selected.toString()}
                    onChange={(e) => onSelect(BigInt(e.target.value))}
                    aria-label="Iniciativa"
                  >
                    {openProposals.map((r) => (
                      <option key={r.id.toString()} value={r.id.toString()}>
                        Iniciativa #{r.id.toString()}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </fieldset>

            <fieldset disabled={selected === null || !address}>
              <legend className="font-code-sm text-code-sm text-on-surface uppercase font-semibold mb-space-xs">
                2. Elige cómo se registra tu voto:
              </legend>
              <div className="space-y-space-sm">
                <ModeOption
                  name="ballot_mode"
                  value="public"
                  checked={mode === "public"}
                  onChange={() => setMode("public")}
                  label="Público (public_v1)"
                  desc="Registrado contra tu dirección. Transparente y verificable."
                />
                <ModeOption
                  name="ballot_mode"
                  value="commitment"
                  checked={mode === "commitment"}
                  onChange={() => setMode("commitment")}
                  label="Por compromiso (commitment_v1)"
                  desc={
                    membershipRoot === null
                      ? rootRead?.status === "unknown"
                        ? "No se pudo leer la raíz de membresía de esta propuesta."
                        : "Ningún administrador publicó una raíz de membresía: el contrato rechazaría la boleta."
                      : `Raíz publicada en cadena: ${membershipRoot.slice(0, 12)}… El recuento se indexa por nullificador, no por tu dirección.`
                  }
                />
              </div>
            </fieldset>

            <fieldset disabled={selected === null || !address}>
              <legend className="font-code-sm text-code-sm text-on-surface uppercase font-semibold mb-space-xs">
                3. Selecciona tu decisión deliberada:
              </legend>
              <div className="space-y-space-sm">
                {CHOICES.map((c) => (
                  <label
                    key={c.value}
                    className={`cursor-pointer block transition-all p-space-md ${
                      choice === c.value ? "bg-surface-container-highest" : "bg-surface-container-low hover:bg-surface-container"
                    }`}
                  >
                    <div className="flex items-start gap-space-sm">
                      <input
                        type="radio"
                        name="ballot_choice"
                        value={c.value}
                        checked={choice === c.value}
                        onChange={() => setChoice(c.value)}
                        className="mt-1 w-4 h-4 accent-primary cursor-pointer"
                      />
                      <div className="flex flex-col">
                        <span className="font-body-md text-body-md font-semibold text-on-surface">{c.label}</span>
                        <span className="font-body-sm text-body-sm text-on-surface-variant">{c.desc}</span>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="p-space-sm bg-surface-container-high/60 mt-space-md">
              <div className="flex gap-space-xs items-start">
                <span className="material-symbols-outlined text-outline text-[18px] mt-0.5" aria-hidden="true">shield</span>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  <strong>Nota de privacidad:</strong> este voto va firmado por tu
                  dirección de cartera y es <strong>públicamente visible</strong> en
                  la cadena. No es anónimo. La modalidad{" "}
                  <code className="font-code-sm text-code-sm font-semibold">commitment_v1</code>{" "}
                  oculta la dirección en el recuento, pero no prueba pertenencia y se
                  marca UNVERIFIED_COMMITMENT. No existe anonimato verificable (
                  <code className="font-code-sm text-code-sm font-semibold">zk_v1</code>) hasta
                  que haya un verificador ZK desplegado.
                </p>
              </div>
            </div>

            {txError && (
              <p className="p-space-sm bg-error-container text-on-error-container font-body-sm text-body-sm" role="alert">
                La transacción no se pudo emitir: {txError}
              </p>
            )}

            {!address && (
              <button
                type="button"
                className="w-full py-space-sm bg-surface-container-highest text-on-surface font-body-md font-semibold hover:bg-surface-container transition-colors disabled:opacity-50"
                onClick={() => void connect()}
                disabled={connecting || available === false}
              >
                {connecting ? "Conectando…" : "Conectar cartera"}
              </button>
            )}

            {address && (
              <button
                type="submit"
                className="w-full bg-primary hover:bg-primary-container text-on-primary py-3 px-space-md font-body-md text-body-md font-semibold flex items-center justify-center gap-space-xs transition-colors shadow-sm disabled:opacity-50"
                disabled={choice === null || selected === null || phase !== "idle"}
              >
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">fingerprint</span>
                {phase === "signing"
                  ? "Esperando firma…"
                  : phase === "submitting"
                    ? "Enviando al ledger…"
                    : "Confirmar y emitir voto"}
              </button>
            )}
          </form>

          {receipt && (
            <div className="mt-space-md p-space-md bg-surface-container-lowest border-l-4 border-l-primary" role="status" aria-live="polite">
              <div className="flex items-center gap-space-xs text-primary font-semibold font-code-sm text-code-sm mb-1">
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">verified</span>
                <span>¡VOTO EMITIDO!</span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface mb-2">
                Iniciativa #{receipt.proposalId.toString()} · opción {receipt.choice} · modo {receipt.mode} · {receipt.at}
              </p>
              <div className="bg-surface-container-low p-space-xs font-code-sm text-code-sm text-on-surface-variant brujula-break select-all">
                TX: {receipt.txHash || UNKNOWN} · ledger: {receipt.confirmedLedger}
                {receipt.nullifier && (
                  <>
                    <br />
                    NULLIFICADOR: {receipt.nullifier}
                  </>
                )}
              </div>
              <button type="button" className="mt-2 px-space-md py-space-sm bg-surface-container text-on-surface font-body-sm font-semibold" onClick={reset}>
                Emitir otro voto
              </button>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 flex flex-col gap-space-lg">
          <TallyPanel selected={selected} tally={tally} loading={tallyLoading} onReload={() => selected && void reloadTally(selected)} />
          <div className="bg-surface-container-low p-space-md space-y-space-xs">
            <div className="flex items-center gap-space-xs text-on-surface font-semibold font-body-md text-body-md">
              <span className="material-symbols-outlined text-[20px] text-primary" aria-hidden="true">policy</span>
              <span>Garantía de escrutinio</span>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              El recuento se relee del contrato en cada emisión. El verificador
              comprueba la consistencia interna; si algo no cuadra, lo declara
              INCONSISTENTE en vez de ocultarlo.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ModeOption({
  name,
  value,
  checked,
  onChange,
  label,
  desc,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  desc: string;
}) {
  return (
    <label
      className={`cursor-pointer block transition-all p-space-md ${
        checked ? "bg-surface-container-highest" : "bg-surface-container-low hover:bg-surface-container"
      }`}
    >
      <div className="flex items-start gap-space-sm">
        <input
          type="radio"
          name={name}
          value={value}
          checked={checked}
          onChange={onChange}
          className="mt-1 w-4 h-4 accent-primary cursor-pointer"
        />
        <div className="flex flex-col">
          <span className="font-body-md text-body-md font-semibold text-on-surface">{label}</span>
          <span className="font-body-sm text-body-sm text-on-surface-variant">{desc}</span>
        </div>
      </div>
    </label>
  );
}

function TallyPanel({
  selected,
  tally,
  loading,
  onReload,
}: {
  selected: bigint | null;
  tally: Read<VerificationResult> | null;
  loading: boolean;
  onReload: () => void;
}) {
  const verdict = tally?.status === "ok" ? tally.value.verdict : "unknown";
  // Named `tallyMode` to avoid shadowing the ballot-mode selector above it.
  const tallyMode = tally?.status === "ok" ? (tally.value.mode ?? UNKNOWN) : UNKNOWN;
  // `mode` is the raw on-chain label, or null when there is nothing to say.
  const onChainMode = tally?.status === "ok" ? (tally.value.mode ?? null) : null;
  const t = tally?.status === "ok" ? tally.value.tally : null;

  return (
    <div className="bg-surface-container-lowest p-space-lg space-y-space-md">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-space-xs">
          <span className="material-symbols-outlined text-outline text-[20px]" aria-hidden="true">analytics</span>
          <h3 className="font-headline-md text-headline-md text-on-surface">Monitoreo del Escrutinio</h3>
        </div>
        <button
          type="button"
          onClick={onReload}
          disabled={selected === null}
          className="px-space-sm py-1 bg-surface-container-high text-on-surface font-code-sm text-code-sm disabled:opacity-50"
        >
          {loading ? "Leyendo…" : "Releer recuento"}
        </button>
      </div>

      <div className="space-y-space-xs">
        <div className="flex justify-between items-baseline font-body-sm text-body-sm">
          <span className="text-on-surface font-semibold">
            {selected === null ? UNKNOWN : `Iniciativa #${selected.toString()}`}
          </span>
          <span className="font-code-sm text-code-sm text-outline">
            {t ? `${t.total.toString()} VOTOS TOTALES` : "SIN LECTURA"}
          </span>
        </div>
        <div className="flex justify-between font-code-sm text-code-sm">
          <span className={verdict === "verified" ? "text-primary font-bold" : verdict === "mismatch" ? "text-error font-bold" : "text-outline font-bold"}>
            {verdict === "verified" ? "[✓ VERIFICADO]" : verdict === "mismatch" ? "[⚠ INCONSISTENTE]" : `[? ${UNKNOWN}]`}
          </span>
          <span className="text-outline">modo: {tallyMode}</span>
        </div>
        {t && t.total > 0n ? (
          <>
            <div className="w-full h-3 bg-surface-container overflow-hidden">
              <div className="h-full bg-primary transition-all duration-700" style={{ width: pct(t.public_votes, t.total) }} />
            </div>
            <div className="flex justify-between font-code-sm text-code-sm text-outline">
              <span>PÚBLICOS: {t.public_votes.toString()}</span>
              <span>COMPROMISO: {t.commitment_votes.toString()}</span>
            </div>
            <div className="pt-space-sm space-y-space-sm">
              <div className="font-code-sm text-code-sm uppercase text-outline font-semibold">Distribución registrada en cadena</div>
              <div className="w-full h-4 flex overflow-hidden bg-surface-container">
                {[...t.counts.entries()].map(([choice, n]) => (
                  <div
                    key={choice}
                    className="bg-primary h-full"
                    style={{ width: pct(n, t.total) }}
                    title={`Opción ${choice}: ${n.toString()}`}
                  />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-space-xs pt-1">
                {[...t.counts.entries()].map(([choice, n]) => (
                  <div key={choice} className="p-space-xs bg-surface-container-low">
                    <span className="font-code-sm text-code-sm text-primary block font-semibold">{pct(n, t.total)}%</span>
                    <span className="text-on-surface-variant font-body-sm text-body-sm">
                      Opción {choice} ({n.toString()})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-space-sm p-space-sm bg-surface-container-low border border-dashed border-outline">
            <span className="font-code-sm text-code-sm font-bold text-outline">
              [{tally === null ? "SIN LECTURA" : t ? "SIN VOTOS" : UNKNOWN}]
            </span>
            <span className="font-body-sm text-body-sm text-on-surface-variant">
              {tally?.status === "unknown"
                ? tally.reason
                : t
                  ? "el recuento existe pero está en cero: la cadena lo dice, no lo suponemos"
                  : "elige una iniciativa para leer su recuento"}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-space-xs">
        <p className="font-body-sm text-body-sm text-on-surface-variant">{commitmentDisclosure(onChainMode)}</p>
        {tally?.status === "ok" && (
          <details>
            <summary className="font-code-sm text-code-sm text-outline cursor-pointer">
              comprobaciones del verificador ({tally.value.checks.length})
            </summary>
            <ul className="pt-space-xs space-y-1 font-code-sm text-code-sm">
              {tally.value.checks.map((c) => (
                <li key={c.id} className={c.state === true ? "text-primary" : c.state === false ? "text-error" : "text-outline"}>
                  <strong>{c.id}</strong>: {c.state === true ? "OK" : c.state === false ? "FALLA" : "DESCONOCIDO"}
                  <span className="text-on-surface-variant"> — {c.detail}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function pct(part: bigint, total: bigint): string {
  if (total === 0n) return "0%";
  return `${(Number((part * 10000n) / total) / 100).toFixed(1)}%`;
}
