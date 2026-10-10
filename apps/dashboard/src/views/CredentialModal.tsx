/**
 * Credential verifier.
 *
 * The previous version of this modal set `verified = true` on click and
 * rendered "[HABILITADO PARA VOTAR]" for ANY input — it never contacted the
 * chain, so it told users they could vote when they could not. That is the most
 * damaging possible failure for this product, and it is now gone.
 *
 * Now the lookup is a real `get_credential` + `is_eligible` pair read from
 * `brujula-identity`, and every outcome maps to an honest label:
 *
 *   read failed          → DESCONOCIDO
 *   no credential        → SIN CREDENCIAL
 *   status REVOKED       → REVOCADA
 *   status SUSPENDED     → SUSPENDIDA
 *   ACTIVE && eligible   → HABILITADA
 *   ACTIVE && !eligible  → NO HABILITADA
 */

import { useEffect, useState } from "react";

import { CREDENTIAL_STATUS } from "@brugulacivica/sdk";
import { fetchCredential } from "../lib/chain.js";
import { dateOrUnknown, shortHash, UNKNOWN } from "../lib/format.js";
import { useWallet } from "../lib/wallet.js";

type Verdict =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "none" }
  | {
      kind: "found";
      eligible: boolean;
      status: number;
      commitment: string;
      credentialType: string;
      issuedAt: bigint;
      updatedAt: bigint;
    };

const STATUS_LABEL: Record<number, string> = {
  [CREDENTIAL_STATUS.ACTIVE]: "ACTIVA",
  [CREDENTIAL_STATUS.SUSPENDED]: "SUSPENDIDA",
  [CREDENTIAL_STATUS.REVOKED]: "REVOCADA",
};

export default function CredentialModal({ onClose }: { onClose: () => void }) {
  const { address } = useWallet();
  const [input, setInput] = useState(address ?? "");
  const [verdict, setVerdict] = useState<Verdict>({ kind: "idle" });

  useEffect(() => {
    if (address && input === "") setInput(address);
  }, [address, input]);

  const looksLikeAddress = /^G[A-Z2-7]{55}$/.test(input.trim());

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    const subject = input.trim();
    if (!looksLikeAddress) {
      setVerdict({
        kind: "error",
        message:
          "Esa cadena no parece una dirección pública de Stellar (debe empezar por G y tener 56 caracteres).",
      });
      return;
    }

    setVerdict({ kind: "loading" });
    try {
      const { credential, eligible } = await fetchCredential(subject);
      if (credential.status === "unknown") {
        setVerdict({ kind: "error", message: credential.reason });
        return;
      }
      if (credential.value === null) {
        setVerdict({ kind: "none" });
        return;
      }
      if (eligible.status === "unknown") {
        setVerdict({ kind: "error", message: eligible.reason });
        return;
      }
      const c = credential.value;
      setVerdict({
        kind: "found",
        eligible: eligible.value,
        status: c.status,
        commitment: c.commitment,
        credentialType: c.credential_type,
        issuedAt: c.issued_at,
        updatedAt: c.updated_at,
      });
    } catch (err) {
      setVerdict({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="modal-backdrop" id="credential-modal">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head">
          <div className="modal-head-left">
            <h2 className="modal-title" id="modal-title">
              Verificar credencial en cadena
            </h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <p className="modal-desc">
          Consulta <code>brujula-identity</code> para una dirección pública. La
          credencial se valida contra el estado real del contrato; no se infiere nada
          ni se concede habilitación por soliciting esta pantalla.
        </p>

        <form onSubmit={verify}>
          <div className="modal-field">
            <label className="modal-field-label" htmlFor="did-input">
              DIRECCIÓN PÚBLICA (G…):
            </label>
            <input
              id="did-input"
              className="modal-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="G…"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cerrar
            </button>
            <button type="submit" className="btn btn-primary" disabled={verdict.kind === "loading"}>
              {verdict.kind === "loading" ? "Consultando…" : "Verificar en cadena"}
            </button>
          </div>
        </form>

        <div className="modal-status" aria-live="polite">
          <VerdictPanel verdict={verdict} />
        </div>
      </div>
    </div>
  );
}

function VerdictPanel({ verdict }: { verdict: Verdict }) {
  switch (verdict.kind) {
    case "idle":
      return (
        <div className="unknown">
          <span className="chip chip-unknown">SIN CONSULTAR</span>
          <span className="reason">
            introduce una dirección y pulsa "Verificar en cadena"
          </span>
        </div>
      );
    case "loading":
      return (
        <div className="unknown">
          <span className="chip chip-unknown">LEYENDO</span>
          <span className="reason">consultando brujula-identity…</span>
        </div>
      );
    case "error":
      // `role="alert"` so a failed verification is announced, not rendered
      // silently into a corner of the modal.
      return (
        <div className="unknown" role="alert">
          <span className="chip chip-unknown">{UNKNOWN}</span>
          <span className="reason">{verdict.message}</span>
        </div>
      );
    case "none":
      return (
        <div className="unknown">
          <span className="chip chip-unknown">SIN CREDENCIAL</span>
          <span className="reason">
            la cadena responde correctamente: no hay credencial emitida para esta
            dirección, así que no puede votar
          </span>
        </div>
      );
    case "found": {
      const revocada = verdict.status === CREDENTIAL_STATUS.REVOKED;
      const suspendida = verdict.status === CREDENTIAL_STATUS.SUSPENDED;
      const habilitada = verdict.eligible && !revocada && !suspendida;
      const cls = habilitada ? "status-ok" : revocada ? "status-bad" : "status-pending";
      const label = habilitada
        ? "[✓ HABILITADA PARA VOTAR]"
        : revocada
          ? "[× REVOCADA — DEFINITIVO]"
          : suspendida
            ? "[× SUSPENDIDA]"
            : "[× NO HABILITADA]";
      return (
        <>
          <div className="status-row">
            <span className="status-key">ESTADO EN CADENA:</span>
            <span className={`status-value ${cls}`}>{label}</span>
          </div>
          <div className="status-row">
            <span className="status-key">ESTADO CREDENCIAL:</span>
            <span className="status-value">{STATUS_LABEL[verdict.status] ?? UNKNOWN}</span>
          </div>
          <div className="status-row">
            <span className="status-key">TIPO:</span>
            <span className="status-value">{verdict.credentialType}</span>
          </div>
          <div className="status-row">
            <span className="status-key">COMPROMISO (32 bytes):</span>
            <span className="status-value">
              <code title={verdict.commitment}>{shortHash(verdict.commitment, 16, 8)}</code>
            </span>
          </div>
          <div className="status-row">
            <span className="status-key">EMITIDA:</span>
            <span className="status-value">{dateOrUnknown(verdict.issuedAt)}</span>
          </div>
          <div className="status-row">
            <span className="status-key">ÚLTIMA ACTUALIZACIÓN:</span>
            <span className="status-value">{dateOrUnknown(verdict.updatedAt)}</span>
          </div>
          <p className="modal-desc" style={{ marginTop: "10px" }}>
            La cadena almacena únicamente este compromiso. Tu nombre, documento o
            correo nunca se registran aquí.
          </p>
        </>
      );
    }
  }
}