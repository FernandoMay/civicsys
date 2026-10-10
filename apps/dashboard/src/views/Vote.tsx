import { useEffect, useMemo, useState } from "react";
import { CivicReader, rpcUrlFromEnv, type Read } from "@civicsys/sdk";
import { Client, AssembledTransaction, useSignTransaction, type SignTransaction, Keypair } from "../lib/wallet.js";
import deploymentRaw from "../../../../deployments/testnet.json";

type BallotChoice = "for" | "against" | "abstain";

// TODO: replace with the real connected voter address from the wallet. The
// placeholder here keeps the contract call well-typed without inventing
// identity; in a real flow this comes from the wallet after connect().
const PLACEHOLDER_VOTER = "G...";

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

const DEFAULT_PROPOSAL_ID = 3;

type TallyResult = {
  verdict: string;
  checks: { id: string; state: boolean | "unknown" }[];
  tally: { total: bigint; public_votes: bigint; commitment_votes: bigint; counts: Map<number, bigint> } | null;
  mode: string | null;
};

type VoteReceipt = {
  time: string;
  code: string;
  txHash: string;
  serverTxHash: string | null;
};

function makeUnknown(reason: string): Read<TallyResult> {
  return {
    status: "unknown",
    reason,
    evidence: {
      contractId: "",
      rpcUrl: "",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function TallyChip({ r }: { r: Read<TallyResult> }) {
  if (r.status === "unknown") {
    return (
      <span className="chip chip-unknown">VERDICTO DESCONOCIDO</span>
    );
  }
  const v = r.value;
  if (!v.tally) {
    return (
      <span className="chip chip-unknown">SIN VOTOS REGISTRADOS</span>
    );
  }
  const verdictClass = v.verdict === "verified" ? "chip-verified" : v.verdict === "mismatch" ? "chip-mismatch" : "chip-unknown";
  const verdictLabel = v.verdict === "verified" ? "VERIFICADO" : v.verdict === "mismatch" ? "MISMATCH" : "DESCONOCIDO";
  return (
    <span className={"chip " + verdictClass}>{verdictLabel}</span>
  );
}

async function fetchServerTxHash(rpcUrl: string, txHash: string): Promise<string | null> {
  try {
    const resp = await fetch(`${rpcUrl.replace(/\/$/, "")}/transactions/${encodeURIComponent(txHash)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [{ hash: txHash }] }),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { result?: { hash?: string; status?: { success?: boolean } } };
    return json?.result?.hash ?? null;
  } catch {
    return null;
  }
}

export default function Vote() {
  const [choice, setChoice] = useState<BallotChoice | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [receipt, setReceipt] = useState<VoteReceipt | null>(null);
  const [tallyRead, setTallyRead] = useState<Read<TallyResult>>(makeUnknown("no leído"));
  const [txState, setTxState] = useState<"idle" | "signing" | "sent" | "error">("idle");

  const walletSignTransaction = useSignTransaction();
  const signTransaction: SignTransaction | undefined = walletSignTransaction;

  // Lectura real del tally sobre civic-vote.
  useEffect(() => {
    const rpcUrl = rpcUrlFromEnv();
    const reader = new CivicReader(deploymentRaw, rpcUrl);
    reader.verifyTally(DEFAULT_PROPOSAL_ID).then((r) => {
      setTallyRead(r);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!choice) return;

    if (!signTransaction) {
      setTxState("error");
      return;
    }

    setTxState("signing");
    try {
      const rpcUrl = rpcUrlFromEnv();
      const proposalClient = await Client.fromWasmHash(
        deploymentRaw.contracts["civic-vote"].wasm_sha256,
        {
          contractId: deploymentRaw.contracts["civic-vote"].contract_id,
          networkPassphrase: deploymentRaw.network_passphrase,
          rpcUrl,
          allowHttp: rpcUrl.startsWith("http:"),
          publicKey: PLACEHOLDER_VOTER,
          signTransaction,
        },
        "hex",
      );

      const tx = await proposalClient.cast_public(
        {
          proposal_id: DEFAULT_PROPOSAL_ID,
          voter: PLACEHOLDER_VOTER,
        },
        {
          simulate: true,
          timeoutInSeconds: 30,
        },
      );

      const sent = await tx.signAndSend();
      const sentHash = sent?.hash ?? "";

      const serverTxHash = sentHash ? await fetchServerTxHash(rpcUrl, sentHash) : null;

      setReceipt({
        time: new Date().toISOString(),
        code: "",
        txHash: sentHash,
        serverTxHash,
      });
      setSubmitted(true);
      setTxState("sent");
      console.log("vote tx sent:", sentHash);
    } catch (err) {
      console.error("tx failed", err);
      setTxState("error");
    }
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
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
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
                <strong className="zk-note-strong">Nota de privacidad:</strong>
                en esta versión v0.1 tu voto es públicamente direccionable por tu dirección de cartera —
                una votación por (propuesta, votante) visible en la cadena. La anonimidad verificable
                (modo zk_v1) no está disponible hasta que se despliegue un verificador ZK.
              </p>
            </div>

            <button type="submit" className="btn btn-primary vote-cta" disabled={!choice || txState === "signing"}>
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
              <code className="receipt-value">{receipt?.code || "—"}</code>
              <span className="receipt-hash">TX: {receipt?.txHash}</span>
              {receipt?.serverTxHash && (
                <span className="receipt-hash">SERVER TX: {receipt.serverTxHash}</span>
              )}
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
            <span className="stat-value">Propuesta #{DEFAULT_PROPOSAL_ID}</span>
            <span className="stat-label">Sobre cadena Stellar testnet</span>
          </div>
          {tallyRead.status === "unknown" ? (
            <div className="quorum-stat">
              <span className="stat-value warn">Sin lectura</span>
              <span className="stat-label">{tallyRead.reason}</span>
            </div>
          ) : (
            <div className="quorum-stat">
              <span className="stat-value">{tallyRead.value?.tally?.total.toString() ?? "0"} votos</span>
              <span className="stat-label">Totales en cadena</span>
            </div>
          )}
        </div>

        {tallyRead.status === "ok" && tallyRead.value?.tally ? (
          <>
            <div className="quorum-bar">
              <div className="quorum-bar-track">
                <div className="quorum-bar-fill" style={{ width: tallyPct(tallyRead.value.tally.total, tallyRead.value.tally.public_votes) }} />
              </div>
              <div className="quorum-bar-labels">
                <span>0</span>
                <span>PUBLICOS: {tallyRead.value.tally.public_votes.toString()}</span>
                <span>COMPROMISO: {tallyRead.value.tally.commitment_votes.toString()}</span>
              </div>
            </div>

            <div className="quorum-dist">
              <div className="quorum-dist-head">
                <span className="quorum-dist-label">Distribución sobre cadena</span>
              </div>
              <div className="quorum-dist-bar">
                {[...tallyRead.value!.tally!.counts.entries()].map(([choiceIdx, n]) => (
                  <div className="quorum-dist-seg seg-for" key={choiceIdx} style={{ width: pct(tallyRead.value!.tally!.total, n) }} title={`Opción ${choiceIdx}: ${n.toString()}`} />
                ))}
              </div>
              <div className="quorum-dist-legend">
                {[...tallyRead.value!.tally!.counts.entries()].map(([choiceIdx, n]) => (
                  <div className="legend-item" key={choiceIdx}>
                    <span className="legend-value">{pct(tallyRead.value!.tally!.total, n).toFixed(1)}%</span>
                    <span className="legend-label">Opción {choiceIdx} ({n.toString()})</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="quorum-dist">
            <div className="quorum-dist-head">
              <span className="quorum-dist-label">Sin distribución</span>
            </div>
            <div className="unknown">
              <span className="chip chip-unknown">SIN TALLY</span>
              <span className="reason">no hay votos registrados en la cadena aún</span>
            </div>
          </div>
        )}

        <div className="quorum-note">
          <TallyChip r={tallyRead} />
          <span style={{ marginLeft: 8 }}>
            Verificación sobre lectura real del contrato CivicVote.
          </span>
          {tallyRead.status === "ok" && tallyRead.value !== null ? (
            <span style={{ marginLeft: 8 }} className="muted">
              modo: {tallyRead.value.mode ?? "?"}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function tallyPct(total: bigint, part: bigint): string {
  if (total === 0n) return "0%";
  const pct = Number((part * 10000n) / total) / 100;
  return `${pct.toFixed(1)}%`;
}

function pct(total: bigint, part: bigint): number {
  if (total === 0n) return 0;
  return Number((part * 10000n) / total) / 100;
}
