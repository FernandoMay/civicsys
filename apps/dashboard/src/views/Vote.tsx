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

import { fetchTally, type ProposalRow } from "../lib/chain.js";
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

type Receipt = {
  at: string;
  txHash: string;
  proposalId: bigint;
  choice: number;
  voter: string;
  confirmedLedger: string;
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
      const client = await voteClient(address, signTransaction);

      setPhase("submitting");
      const tx = await client.cast_public({
        proposal_id: selected,
        voter: address,
        choice,
      });

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
        voter: address,
        confirmedLedger: ledger === undefined ? UNKNOWN : String(ledger),
      });
      setPhase("sent");
      await reloadTally(selected);
    } catch (err) {
      setTxError(describe(err));
      setPhase("idle");
    }
  };

  return (
    <section className="vote-section" id="votar">
      <div className="vote-card">
        <div className="vote-head">
          <div className="vote-head-left">
            <span className="vote-dot" aria-hidden="true" />
            <h2 className="vote-title">Terminal de Emisión de Voto</h2>
          </div>
          <span className="vote-spec">MODO public_v1</span>
        </div>

        <div className="vote-identity">
          <div className="vote-identity-row">
            <div className="vote-identity-avatar">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
            </div>
            <div className="vote-identity-info">
              <span className="vote-identity-name">
                {address ? address : "SIN CARTERA CONECTADA"}
              </span>
              <span className="vote-identity-meta">
                {address
                  ? "Identidad tomada de tu cartera"
                  : "El contrato exige una firma; no se puede votar sin cartera"}
              </span>
            </div>
            <span className="vote-identity-badge">
              {address ? "[✓ CARTERA CONECTADA]" : "[? SIN CARTERA]"}
            </span>
          </div>
        </div>

        {/* Kept outside `.vote-identity` on purpose: that element is a flex row,
            so a block-level notice inside it becomes a squeezed sibling. */}
        {available === false && (
          <p className="vote-zk-note" role="status">
            <strong className="zk-note-strong">Cartera no detectada:</strong>{" "}
            {walletError ??
              "instala Freighter (u otra compatible) para poder firmar transacciones."}
          </p>
        )}

        <form className="vote-form" onSubmit={submit}>
          <fieldset>
            <legend className="vote-legend">1. Elige la iniciativa abierta:</legend>
            {openProposals.length === 0 ? (
              <div className="unknown">
                <span className="chip chip-unknown">SIN CONSULTAS ABIERTAS</span>
                <span className="reason">
                  ninguna propuesta tiene su ventana de votación abierta ahora mismo
                </span>
              </div>
            ) : (
              <label className="vote-option">
                <select
                  className="modal-input"
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
            <legend className="vote-legend">2. Selecciona tu decisión deliberada:</legend>
            {CHOICES.map((c) => (
              <label
                key={c.value}
                className={`vote-option ${choice === c.value ? "vote-option-selected" : ""}`}
              >
                <input
                  type="radio"
                  name="ballot_choice"
                  value={c.value}
                  checked={choice === c.value}
                  onChange={() => setChoice(c.value)}
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
              <strong className="zk-note-strong">Nota de privacidad:</strong> este
              voto va firmado por tu dirección de cartera y es{" "}
              <strong>públicamente visible</strong> en la cadena. No es anónimo. La
              modalidad <code>commitment_v1</code> oculta la dirección en el recuento,
              pero no prueba pertenencia y se marca UNVERIFIED_COMMITMENT. No existe
              anonymity verificable (<code>zk_v1</code>) hasta que haya un verificador
              ZK desplegado.
            </p>
          </div>

          {txError && (
            <p className="vote-error" role="alert">
              La transacción no se pudo emitir: {txError}
            </p>
          )}

          {!address && (
            <button
              type="button"
              className="btn btn-secondary vote-cta"
              onClick={() => void connect()}
              disabled={connecting || available === false}
            >
              {connecting ? "Conectando…" : "Conectar cartera"}
            </button>
          )}

          {address && (
            <button
              type="submit"
              className="btn btn-primary vote-cta"
              disabled={choice === null || selected === null || phase !== "idle"}
            >
              {phase === "signing"
                ? "Esperando firma…"
                : phase === "submitting"
                  ? "Enviando al ledger…"
                  : "Confirmar y emitir voto"}
            </button>
          )}
        </form>

        {receipt && (
          <div className="vote-receipt" role="status" aria-live="polite">
            <div className="receipt-head">
              <span className="receipt-title">VOTO EMITIDO</span>
            </div>
            <p className="receipt-time">
              Iniciativa #{receipt.proposalId.toString()} · opción {receipt.choice} ·{" "}
              {receipt.at}
            </p>
            <div className="receipt-code">
              <span className="receipt-label">TX:</span>
              <code className="receipt-value">{receipt.txHash || UNKNOWN}</code>
              <span className="receipt-hash">ledger: {receipt.confirmedLedger}</span>
            </div>
            <button type="button" className="btn btn-secondary" onClick={reset}>
              Emitir otro voto
            </button>
          </div>
        )}
      </div>

      <TallyPanel selected={selected} tally={tally} loading={tallyLoading} onReload={() => selected && void reloadTally(selected)} />
    </section>
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
  const mode = tally?.status === "ok" ? (tally.value.mode ?? UNKNOWN) : UNKNOWN;
  const t = tally?.status === "ok" ? tally.value.tally : null;

  return (
    <div className="quorum-card">
      <div className="quorum-head">
        <div className="quorum-head-left">
          <h3 className="quorum-title">Monitoreo del Escrutinio</h3>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onReload} disabled={selected === null}>
          {loading ? "Leyendo…" : "Releer recuento"}
        </button>
      </div>

      <div className="quorum-stats">
        <div className="quorum-stat">
          <span className="stat-value">
            {selected === null ? UNKNOWN : `Iniciativa #${selected.toString()}`}
          </span>
          <span className="stat-label">leída desde brujula-vote</span>
        </div>
        <div className="quorum-stat">
          <span className="stat-value">{t ? t.total.toString() : UNKNOWN}</span>
          <span className="stat-label">votos totales</span>
        </div>
        <div className="quorum-stat">
          <span className="stat-value">
            {verdict === "verified"
              ? "VERIFICADO"
              : verdict === "mismatch"
                ? "INCONSISTENTE"
                : UNKNOWN}
          </span>
          <span className="stat-label">veredicto del verificador</span>
        </div>
      </div>

      {t && t.total > 0n ? (
        <>
          <div className="quorum-bar">
            <div className="quorum-bar-track">
              <div
                className="quorum-bar-fill"
                style={{ width: pct(t.public_votes, t.total) }}
              />
            </div>
            <div className="quorum-bar-labels">
              <span>0</span>
              <span>PÚBLICOS: {t.public_votes.toString()}</span>
              <span>COMPROMISO: {t.commitment_votes.toString()}</span>
            </div>
          </div>

          <div className="quorum-dist">
            <div className="quorum-dist-head">
              <span className="quorum-dist-label">Distribución registrada en cadena</span>
            </div>
            <div className="quorum-dist-bar">
              {[...t.counts.entries()].map(([choice, n]) => (
                <div
                  className="quorum-dist-seg seg-for"
                  key={choice}
                  style={{ width: pct(n, t.total) }}
                  title={`Opción ${choice}: ${n.toString()}`}
                />
              ))}
            </div>
            <div className="quorum-dist-legend">
              {[...t.counts.entries()].map(([choice, n]) => (
                <div className="legend-item" key={choice}>
                  <span className="legend-value">{pct(n, t.total)}%</span>
                  <span className="legend-label">
                    Opción {choice} ({n.toString()})
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="quorum-dist">
          <div className="unknown">
            <span className="chip chip-unknown">
              {tally === null ? "SIN LECTURA" : t ? "SIN VOTOS" : UNKNOWN}
            </span>
            <span className="reason">
              {tally?.status === "unknown"
                ? tally.reason
                : t
                  ? "el recuento existe pero está en cero: la cadena lo dice, no lo suponemos"
                  : "elige una iniciativa para leer su recuento"}
            </span>
          </div>
        </div>
      )}

      <div className="quorum-note">
        <span className="muted">modo de verificación: {mode}</span>
        {tally?.status === "ok" && (
          <ul className="quorum-checks">
            {tally.value.checks.map((c) => (
              <li key={c.id} className={`check check-${String(c.state)}`}>
                <strong>{c.id}</strong>: {c.state === true ? "OK" : c.state === false ? "FALLA" : "DESCONOCIDO"}
                <span className="muted"> — {c.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function pct(part: bigint, total: bigint): string {
  if (total === 0n) return "0%";
  return `${(Number((part * 10000n) / total) / 100).toFixed(1)}%`;
}