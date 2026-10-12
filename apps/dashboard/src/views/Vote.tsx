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

import { PROPOSAL_STATUS, sha256Utf8, type Read, type VerificationResult } from "@brugulacivica/sdk";

import { CHOICES, choiceLabel } from "../lib/ballot.js";

import { explorerContract, explorerTx, fetchTally, reader, type ProposalRow } from "../lib/chain.js";
import { commitmentDisclosure, generateVoterSecret, prepareCommitmentBallot } from "../lib/commitment.js";
import { voteClient } from "../lib/contracts.js";
import { describe, useSignTransaction, useWallet } from "../lib/wallet.js";
import { UNKNOWN } from "../lib/format.js";

// The ballot names live in lib/ballot so the tally breakdown cannot drift away
// from what a voter was offered.

/**
 * Raised when a connected wallet holds no credential the vote contract accepts.
 *
 * The contract gates public ballots on `brujula-identity` eligibility, so this
 * is a legitimate on-chain state and not a failure of the wallet. The message
 * names the wallet, points at the record, and says who can fix it, because
 * "no sos elegible" left the user with nothing to act on.
 */
class WalletNotEligibleError extends Error {
  readonly address: string;

  constructor(address: string) {
    super(
      "Esta cartera no tiene una credencial activa y elegible en brujula-identity, " +
        "y el voto público está restringido a credenciales emitidas por el administrador. " +
        "Verificá tu credencial o pedí que te emitan una para esta dirección.",
    );
    this.name = "WalletNotEligibleError";
    this.address = address;
  }
}

export type TxPhase = "idle" | "signing" | "submitting" | "sent";

type BallotMode = "public" | "commitment";

const COMMITMENT_DOMAIN = "brujula-civica/testnet/roster";
const COMMITMENT_ATTRIBUTES = "district=00;role=citizen;cohort=commitment-demo";

/**
 * Digest written to `verifier_digest` while no verifier contract exists.
 *
 * The contract accepts the field but never checks it, so it carries no proof
 * either way. Writing the nullifier there would put a misleading value into a
 * permanent on-chain event, so the field instead carries an explicit
 * "unverified" digest that says the same thing the UI says.
 */
const UNVERIFIED_VERIFIER_DIGEST_LABEL = "brujula-civica/commitment_v1/unverified";

/** What the chain says about this wallet on this proposal, read before offering a ballot. */
type VoterStanding = { eligible: boolean; alreadyVoted: boolean };

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
  /** The rejected error itself, so the panel can act on its type. */
  const [txError, setTxError] = useState<unknown>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [tally, setTally] = useState<Read<VerificationResult> | null>(null);
  const [tallyLoading, setTallyLoading] = useState(false);
  /**
   * Whether this wallet may and still can vote on the selected proposal.
   *
   * Read as soon as the wallet or the proposal changes, so a ballot is not
   * offered to someone the chain will reject. `submit()` re-reads both facts
   * before signing regardless, because this read can go stale between render
   * and submission and the contract is the authority, not this screen.
   */
  const [standing, setStanding] = useState<Read<VoterStanding> | null>(null);

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
      // Clear stale state immediately: never keep a previous proposal's root
      // while the new proposal's membership state is still being read.
      setMembershipRoot(null);
      setRootRead(null);
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
      setMembershipRoot(null);
      setRootRead(null);
      return;
    }
    void reloadTally(selected);
  }, [selected, reloadTally]);

  // Read this wallet's standing on the selected proposal as soon as either
  // changes. Offering a ballot to a wallet that cannot use it wastes the
  // person's time and reads as a bug; the contract would refuse it anyway.
  useEffect(() => {
    if (!address || selected === null) {
      setStanding(null);
      return;
    }
    let live = true;
    void (async () => {
      const [eligible, voted] = await Promise.all([
        reader.isEligible(address),
        reader.hasVotedPublic(selected, address),
      ]);
      if (!live) return;
      if (eligible.status !== "ok") {
        // No claim either way: a read failed, so nothing may be asserted about
        // this wallet. The ballot stays available and submit() decides.
        setStanding({ status: "unknown", reason: eligible.reason, evidence: eligible.evidence });
        return;
      }
      if (voted.status !== "ok") {
        setStanding({ status: "unknown", reason: voted.reason, evidence: voted.evidence });
        return;
      }
      setStanding({
        status: "ok",
        value: { eligible: eligible.value, alreadyVoted: voted.value },
        evidence: eligible.evidence,
      });
    })();
    return () => {
      live = false;
    };
  }, [address, selected]);

  // If the selected proposal has no readable membership root, return to the
  // public mode automatically instead of leaving an unusable mode selected.
  useEffect(() => {
    if (mode === "commitment" && membershipRoot === null) setMode("public");
  }, [mode, membershipRoot]);

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

      // Revalidate the live contract state immediately before asking for a
      // signature. The page's proposal list may be stale after the window closes.
      const liveStatus = await reader.proposalStatus(selected);
      if (liveStatus.status !== "ok") {
        throw new Error("No se pudo verificar el estado actual de la iniciativa; no se envió el voto.");
      }
      if (liveStatus.value !== PROPOSAL_STATUS.OPEN) {
        throw new Error("La ventana de votación ya no está abierta en la cadena.");
      }

      if (mode === "public") {
        const eligibility = await reader.isEligible(source);
        if (eligibility.status !== "ok") {
          throw new Error(
            "No se pudo verificar tu elegibilidad en la cadena; no se envió el voto. Reintentá en unos segundos.",
          );
        }
        if (!eligibility.value) {
          // Fail-closed, but the message has to say what to do about it: the
          // wallet is fine, it just has no credential the contract accepts.
          throw new WalletNotEligibleError(source);
        }
        const alreadyVoted = await reader.hasVotedPublic(selected, source);
        if (alreadyVoted.status !== "ok") {
          throw new Error("No se pudo comprobar si esta cartera ya votó; no se envió una segunda boleta.");
        }
        if (alreadyVoted.value) {
          throw new Error("Esta cartera ya emitió un voto público para esta iniciativa.");
        }
      }

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
        const unverifiedVerifierDigest = await sha256Utf8(UNVERIFIED_VERIFIER_DIGEST_LABEL);

        setPhase("submitting");
        tx = await client.cast_commitment({
          proposal_id: selected,
          choice,
          nullifier: prepared.nullifier,
          commitment: prepared.commitment,
          membership_root: prepared.membershipRoot,
          // No verifier contract exists (RFC §5, phase 4b), so this field
          // carries no proof. It is left as an explicit "unverified" digest
          // rather than a reused value, so the published event does not claim
          // a verifier that is not there. Reported UNVERIFIED_COMMITMENT.
          verifier_digest: unverifiedVerifierDigest,
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
      // Keep the error itself, not just its text: the panel acts on its type.
      setTxError(err);
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

          {walletError ? (
            <p className="p-space-sm bg-error-container text-on-error-container font-body-sm text-body-sm" role="alert">
              <strong>No se pudo conectar la cartera:</strong> {walletError}
            </p>
          ) : available === false ? (
            <div className="p-space-sm bg-surface-container-low space-y-space-xs">
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                <strong>No se detectó ninguna cartera.</strong> Instala Freighter desde{" "}
                <a className="text-primary underline" href="https://freighter.app" target="_blank" rel="noreferrer">
                  freighter.app ↗
                </a>{" "}
                y recarga esta página.
              </p>
              <p className="font-code-sm text-code-sm text-outline">
                Si ya la tienes instalada: ábrela, desbloquéala con tu contraseña y comprueba que este sitio
                aparece en su lista de sitios permitidos.
              </p>
            </div>
          ) : (
            <p className="p-space-sm bg-surface-container-low font-body-sm text-body-sm text-on-surface-variant" role="status">
              Sin firma no hay voto: la transacción la paga y la autoriza tu cartera.
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

            {/* The chain already knows this wallet's standing, so say it here
                instead of letting someone fill in a ballot the contract will
                refuse. An unknown read must NOT block voting: the revalidation
                inside submit() is the authority, not this screen. */}
            {standing?.status === "ok" && !standing.value.eligible && (
              <p
                className="p-space-sm bg-surface-container-low text-on-surface-variant font-body-sm text-body-sm"
                role="status"
              >
                Esta cartera no tiene credencial activa y elegible en{" "}
                <a
                  className="underline"
                  href={explorerContract("brujula-identity")}
                  target="_blank"
                  rel="noreferrer"
                >
                  brujula-identity ↗
                </a>
                . El voto público está restringido a credenciales emitidas por el
                administrador.
              </p>
            )}

            {standing?.status === "ok" &&
              standing.value.eligible &&
              standing.value.alreadyVoted && (
                <p
                  className="p-space-sm bg-surface-container-low text-on-surface-variant font-body-sm text-body-sm"
                  role="status"
                >
                  Esta cartera ya emitió su voto en esta iniciativa. El recuento de
                  abajo lo refleja y el contrato no admite una segunda boleta para la
                  misma iniciativa y la misma cartera.
                </p>
              )}

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
                  disabled={membershipRoot === null}
                  desc={
                    membershipRoot === null
                      ? rootRead?.status === "unknown"
                        ? "No se pudo leer la raíz de membresía de esta propuesta. Modo bloqueado hasta confirmar una raíz."
                        : "Ningún administrador publicó una raíz de membresía: modo bloqueado porque el contrato rechazaría la boleta."
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

            {txError !== null && (
              <div className="p-space-sm bg-error-container text-on-error-container space-y-space-xs" role="alert">
                <p className="font-body-sm font-body-sm">
                  <strong>No se pudo emitir el voto:</strong> {describe(txError)}
                </p>
                {/* When the wallet is fine but holds no credential, offer the
                    two actions that actually resolve it instead of a dead end. */}
                {txError instanceof WalletNotEligibleError && (
                  <div className="flex flex-wrap gap-space-sm pt-space-xs">
                    <a
                      className="px-space-sm py-1 bg-surface text-on-surface font-code-sm text-code-sm hover:bg-surface-container"
                      href={explorerContract("brujula-identity")}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Ver contrato de identidad ↗
                    </a>
                    <span className="font-code-sm text-code-sm self-center brujula-break">
                      {txError.address}
                    </span>
                  </div>
                )}
              </div>
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
              {/* The receipt is only worth what the holder can check. Link the
                  transaction and the tally contract directly, so the vote can be
                  re-read from the explorer instead of taken on trust. */}
              <div className="flex flex-wrap gap-space-sm mt-space-sm">
                {receipt.txHash && (
                  <a
                    className="px-space-sm py-1 bg-surface-container text-on-surface font-code-sm text-code-sm hover:bg-surface-container-highest"
                    href={explorerTx(receipt.txHash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver transacción en el explorador ↗
                  </a>
                )}
                <a
                  className="px-space-sm py-1 bg-surface-container text-on-surface font-code-sm text-code-sm hover:bg-surface-container-highest"
                  href={explorerContract("brujula-vote")}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ver contrato de escrutinio ↗
                </a>
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
  disabled = false,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  desc: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`block transition-all p-space-md ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      } ${
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
          disabled={disabled}
          className="mt-1 w-4 h-4 accent-primary cursor-pointer disabled:cursor-not-allowed"
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
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-xs">
          <span className="material-symbols-outlined text-outline text-[20px]" aria-hidden="true">analytics</span>
          <h3 className="font-headline-md text-headline-md text-on-surface">Monitoreo del Escrutinio</h3>
        </div>
        <div className="flex items-center gap-space-sm">
          {/* The tally is only persuasive if the reader can re-read it from the
              contract, so the link sits next to the number itself. */}
          <a
            className="px-space-sm py-1 bg-surface-container-high text-on-surface font-code-sm text-code-sm hover:bg-surface-container"
            href={explorerContract("brujula-vote")}
            target="_blank"
            rel="noreferrer"
          >
            Ver recuento en el explorador ↗
          </a>
          <button
            type="button"
            onClick={onReload}
            disabled={selected === null}
            className="px-space-sm py-1 bg-surface-container-high text-on-surface font-code-sm text-code-sm disabled:opacity-50"
          >
            {loading ? "Leyendo…" : "Releer recuento"}
          </button>
        </div>
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
              <div className="h-full bg-primary transition-all duration-700" style={{ width: `${pct(t.public_votes, t.total)}%` }} />
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
                    style={{ width: `${pct(n, t.total)}%` }}
                    title={`${choiceLabel(choice)}: ${n.toString()}`}
                  />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-space-xs pt-1">
                {[...t.counts.entries()].map(([choice, n]) => (
                  <div key={choice} className="p-space-xs bg-surface-container-low">
                    <span className="font-code-sm text-code-sm text-primary block font-semibold">{pct(n, t.total)}%</span>
                    <span className="text-on-surface-variant font-body-sm text-body-sm">
                      {choiceLabel(choice)} ({n.toString()})
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

/**
 * Numeric percentage only, without the unit, truncated toward zero.
 *
 * Callers append the CSS unit for widths and the label suffix for text, so
 * returning '%' here produced the visible bug "100.0%%".
 *
 * Truncation is deliberate, not laziness. Rounding made 9999/10000 render as
 * "100.0%", i.e. a unanimous tally from a non-unanimous one. A platform whose
 * whole claim is "we never invent a result" must not overstate support, so the
 * value is always rounded DOWN and can only understate, never overstate.
 */
export function pct(part: bigint, total: bigint): string {
  if (total === 0n) return "0.0";
  const tenths = (part * 1000n) / total; // tenths of a percent, truncated
  return `${tenths / 10n}.${tenths % 10n}`;
}
