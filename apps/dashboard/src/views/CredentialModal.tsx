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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-margin-sm bg-on-surface/40" id="credential-modal">
      <div className="bg-surface-container-lowest max-w-lg w-full p-space-lg shadow-xl space-y-space-md" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="flex items-center justify-between pb-space-xs">
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-primary" aria-hidden="true">security</span>
            <span className="font-headline-md text-headline-md font-bold text-on-surface" id="modal-title">
              Verificar credencial en cadena
            </span>
          </div>
          <button type="button" className="text-on-surface-variant hover:text-on-surface" onClick={onClose} aria-label="Cerrar">
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <p className="font-body-sm text-body-sm text-on-surface-variant">
          Consulta <code className="font-code-sm text-code-sm">brujula-identity</code> para
          una dirección pública. La credencial se valida contra el estado real del
          contrato; esta pantalla no concede habilitación por sí misma.
        </p>

        <form onSubmit={verify} className="space-y-space-xs">
          <label className="font-code-sm text-code-sm text-outline block" htmlFor="did-input">
            DIRECCIÓN PÚBLICA (G…):
          </label>
          <input
            id="did-input"
            className="w-full bg-surface p-space-sm font-code-sm text-code-sm text-on-surface outline-none focus:ring-1 focus:ring-primary brujula-break"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="G…"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex items-center justify-end gap-space-sm pt-space-xs">
            <button
              type="button"
              className="px-space-md py-space-sm bg-surface-container text-on-surface font-body-sm font-semibold"
              onClick={onClose}
            >
              Cerrar
            </button>
            <button
              type="submit"
              className="px-space-md py-space-sm bg-primary text-on-primary font-body-sm font-semibold hover:bg-primary-container disabled:opacity-50"
              disabled={verdict.kind === "loading"}
            >
              {verdict.kind === "loading" ? "Consultando…" : "Verificar en cadena"}
            </button>
          </div>
        </form>

        <div aria-live="polite">
          <VerdictPanel verdict={verdict} />
        </div>
      </div>
    </div>
  );
}

function StatusRow({ k, v, highlight = false }: { k: string; v: React.ReactNode; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-space-sm">
      <span className="font-code-sm text-code-sm text-outline shrink-0">{k}:</span>
      <span className={`font-code-sm text-code-sm text-right brujula-break ${highlight ? "text-primary font-bold" : "text-on-surface"}`}>
        {v}
      </span>
    </div>
  );
}

function Notice({ label, reason, alert = false }: { label: string; reason: string; alert?: boolean }) {
  return (
    <div
      className="flex items-center gap-space-sm p-space-sm bg-surface-container-low"
      {...(alert ? { role: "alert" } : {})}
    >
      <span className="font-code-sm text-code-sm font-bold text-outline">[{label}]</span>
      <span className="font-body-sm text-body-sm text-on-surface-variant">{reason}</span>
    </div>
  );
}

function VerdictPanel({ verdict }: { verdict: Verdict }) {
  switch (verdict.kind) {
    case "idle":
      return <Notice label="SIN CONSULTAR" reason='introduce una dirección y pulsa "Verificar en cadena"' />;
    case "loading":
      return <Notice label="LEYENDO" reason="consultando brujula-identity…" />;
    case "error":
      // `role="alert"` so a failed verification is announced, not rendered
      // silently into a corner of the modal.
      return <Notice label={UNKNOWN} reason={verdict.message} alert />;
    case "none":
      return (
        <Notice
          label="SIN CREDENCIAL"
          reason="la cadena responde correctamente: no hay credencial emitida para esta dirección, así que no puede votar"
        />
      );
    case "found": {
      const revocada = verdict.status === CREDENTIAL_STATUS.REVOKED;
      const suspendida = verdict.status === CREDENTIAL_STATUS.SUSPENDED;
      const habilitada = verdict.eligible && !revocada && !suspendida;
      const label = habilitada
        ? "[✓ HABILITADA PARA VOTAR]"
        : revocada
          ? "[× REVOCADA — DEFINITIVO]"
          : suspendida
            ? "[× SUSPENDIDA]"
            : "[× NO HABILITADA]";
      return (
        <div className="p-space-sm bg-surface-container-low space-y-space-xs">
          <div className="font-code-sm text-code-sm text-primary font-bold">{label}</div>
          <StatusRow k="ESTADO CREDENCIAL" v={STATUS_LABEL[verdict.status] ?? UNKNOWN} />
          <StatusRow k="TIPO" v={verdict.credentialType} />
          <StatusRow
            k="COMPROMISO (32 bytes)"
            v={<code title={verdict.commitment}>{shortHash(verdict.commitment, 16, 8)}</code>}
          />
          <StatusRow k="EMITIDA" v={dateOrUnknown(verdict.issuedAt)} />
          <StatusRow k="ACTUALIZADA" v={dateOrUnknown(verdict.updatedAt)} />
          <p className="font-body-sm text-body-sm text-on-surface-variant pt-space-xs">
            La cadena almacena únicamente este compromiso. Tu nombre, documento o
            correo nunca se registran aquí.
          </p>
        </div>
      );
    }
  }
}
