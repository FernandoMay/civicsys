import { useState, type FormEvent } from "react";

import { sha256Utf8 } from "@brugulacivica/sdk";
import { reader } from "../lib/chain.js";
import { proposalClient } from "../lib/contracts.js";
import { describe, useSignTransaction, useWallet } from "../lib/wallet.js";

type Props = { onCreated: () => Promise<void> | void };

function localDateTime(value: Date): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function ProposalComposer({ onCreated }: Props) {
  const { address, available, connecting, connect } = useWallet();
  const signTransaction = useSignTransaction();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [metadata, setMetadata] = useState("{}");
  const [opensAt, setOpensAt] = useState(() => localDateTime(new Date(Date.now() + 5 * 60_000)));
  const [closesAt, setClosesAt] = useState(() => localDateTime(new Date(Date.now() + 7 * 24 * 60 * 60_000)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    if (!address || !signTransaction) {
      setMessage({ kind: "error", text: "Conecta una cartera compatible para firmar la publicación." });
      return;
    }
    const cleanTitle = title.trim();
    const cleanDescription = description.trim();
    if (!cleanTitle || !cleanDescription) {
      setMessage({ kind: "error", text: "El título y la descripción son obligatorios." });
      return;
    }
    if (cleanTitle.length > 240 || cleanDescription.length > 20_000) {
      setMessage({ kind: "error", text: "El título admite 240 caracteres y la descripción 20,000." });
      return;
    }

    let parsedMetadata: unknown;
    try {
      parsedMetadata = JSON.parse(metadata);
      if (parsedMetadata === null || Array.isArray(parsedMetadata) || typeof parsedMetadata !== "object") {
        throw new Error("Los metadatos deben ser un objeto JSON.");
      }
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Metadatos JSON inválidos." });
      return;
    }

    const opens = Math.floor(new Date(opensAt).getTime() / 1000);
    const closes = Math.floor(new Date(closesAt).getTime() / 1000);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(opens) || !Number.isFinite(closes) || opens >= closes || closes <= now) {
      setMessage({ kind: "error", text: "La ventana debe tener fechas válidas, cierre futuro y apertura anterior al cierre." });
      return;
    }

    setBusy(true);
    try {
      // A unique timestamp makes the exact uploaded payload content-addressed
      // and avoids confusing an earlier proposal with this transaction.
      const content = JSON.stringify({
        schema: "brujula-civica/proposal-content@1",
        title: cleanTitle,
        description: cleanDescription,
        metadata,
        created_at: new Date().toISOString(),
      });
      const byteLength = new TextEncoder().encode(content).byteLength;
      if (byteLength > 64 * 1024) throw new Error("El contenido excede el límite de 64 KiB.");

      const pinResponse = await fetch("/.netlify/functions/pin-proposal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const pinResult = await pinResponse.json() as { cid?: string; error?: string; detail?: string };
      if (!pinResponse.ok || !pinResult.cid) {
        throw new Error([pinResult.error ?? "No se pudo publicar el contenido IPFS.", pinResult.detail].filter(Boolean).join(" "));
      }
      const cid = pinResult.cid;

      const [titleHash, descriptionHash, metadataHash, evidenceRoot] = await Promise.all([
        sha256Utf8(cleanTitle),
        sha256Utf8(cleanDescription),
        sha256Utf8(metadata),
        sha256Utf8("[]"),
      ]);

      // Refuse to create if the counter cannot be read. After confirmation we
      // will scan the exact newly allocated ID range and verify the record.
      const before = await reader.nextProposalId();
      if (before.status !== "ok") {
        throw new Error("IPFS publicó el contenido, pero no se pudo leer next_id de la cadena; no se envió la transacción. Conserva el CID para reintentar.");
      }

      const client = await proposalClient(address, signTransaction);
      const tx = await client.create({
        proposer: address,
        title_hash: titleHash,
        description_hash: descriptionHash,
        metadata_hash: metadataHash,
        content_cid: cid,
        evidence_root: evidenceRoot,
        opens_at: BigInt(opens),
        closes_at: BigInt(closes),
      });
      const sent = await tx.signAndSend();
      const txHash = sent.sendTransactionResponse?.hash ?? null;

      const after = await reader.nextProposalId();
      if (after.status !== "ok") {
        setMessage({
          kind: "info",
          text: `La transacción fue enviada${txHash ? ` (${txHash})` : ""}, pero no pude verificar el registro después de releer la cadena. CID: ${cid}. No se afirma que la propuesta esté confirmada.`,
        });
        return;
      }

      let verifiedId: bigint | null = null;
      for (let id = before.value; id < after.value; id += 1n) {
        const read = await reader.getProposal(id);
        if (
          read.status === "ok" &&
          read.value !== null &&
          read.value.content_cid === cid &&
          read.value.proposer === address &&
          read.value.title_hash === titleHash &&
          read.value.description_hash === descriptionHash &&
          read.value.metadata_hash === metadataHash
        ) {
          verifiedId = id;
          break;
        }
      }

      if (verifiedId === null) {
        setMessage({
          kind: "info",
          text: `La transacción fue enviada${txHash ? ` (${txHash})` : ""}, pero la relectura no encontró un registro coincidente. CID: ${cid}. Revisa la cadena antes de reintentar para evitar duplicados.`,
        });
        return;
      }

      setMessage({
        kind: "success",
        text: `Iniciativa #${verifiedId.toString()} creada y releída en Stellar testnet. CID: ${cid}.${txHash ? ` TX: ${txHash}` : ""}`,
      });
      setTitle("");
      setDescription("");
      setMetadata("{}");
      await onCreated();
    } catch (error) {
      setMessage({ kind: "error", text: describe(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-surface-container-low p-space-md space-y-space-sm" aria-labelledby="create-proposal-heading">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm">
        <div>
          <h3 id="create-proposal-heading" className="font-headline-md text-headline-md text-on-surface font-semibold">
            Publicar una iniciativa
          </h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            El contenido se publica en IPFS y sus hashes se anclan en Stellar testnet mediante una transacción firmada.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="px-space-md py-space-sm bg-primary text-on-primary font-body-sm font-semibold"
        >
          {open ? "Cerrar formulario" : "Crear iniciativa"}
        </button>
      </div>

      {open && (
        <form onSubmit={submit} className="space-y-space-md" aria-busy={busy}>
          {!address && (
            <div className="p-space-sm bg-surface-container-lowest">
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Necesitas una cartera con fondos de testnet para publicar y pagar la transacción.
              </p>
              <button
                type="button"
                onClick={() => void connect().catch(() => {})}
                disabled={connecting || available === false}
                className="mt-space-xs px-space-md py-space-sm bg-primary text-on-primary font-body-sm font-semibold disabled:opacity-50"
              >
                {connecting ? "Conectando…" : "Conectar cartera"}
              </button>
            </div>
          )}
          <label className="block space-y-1">
            <span className="font-code-sm text-code-sm uppercase text-outline">Título (máx. 240)</span>
            <input
              required maxLength={240} value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-surface-container-lowest p-space-sm text-on-surface"
              placeholder="Título de la iniciativa"
            />
          </label>
          <label className="block space-y-1">
            <span className="font-code-sm text-code-sm uppercase text-outline">Descripción</span>
            <textarea
              required maxLength={20000} rows={5} value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-surface-container-lowest p-space-sm text-on-surface"
              placeholder="Objetivo, alcance y criterios de evaluación"
            />
          </label>
          <label className="block space-y-1">
            <span className="font-code-sm text-code-sm uppercase text-outline">Metadatos (objeto JSON)</span>
            <textarea
              required rows={3} value={metadata} onChange={(e) => setMetadata(e.target.value)}
              className="w-full bg-surface-container-lowest p-space-sm font-code-sm text-code-sm text-on-surface"
              spellCheck={false}
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
            <label className="block space-y-1">
              <span className="font-code-sm text-code-sm uppercase text-outline">Abre</span>
              <input required type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)}
                className="w-full bg-surface-container-lowest p-space-sm text-on-surface" />
            </label>
            <label className="block space-y-1">
              <span className="font-code-sm text-code-sm uppercase text-outline">Cierra</span>
              <input required type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)}
                className="w-full bg-surface-container-lowest p-space-sm text-on-surface" />
            </label>
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            La publicación de contenido ocurre antes de la transacción. Si la transacción falla, el objeto IPFS puede quedar sin referencia en cadena; no se volverá a enviar automáticamente.
          </p>
          {message && (
            <p role={message.kind === "error" ? "alert" : "status"}
              className={`p-space-sm font-body-sm text-body-sm ${message.kind === "error" ? "bg-error-container text-on-error-container" : "bg-surface-container-lowest text-on-surface"}`}>
              {message.text}
            </p>
          )}
          <button type="submit" disabled={busy || !address || !signTransaction}
            className="w-full py-space-sm bg-primary text-on-primary font-body-md font-semibold disabled:opacity-50">
            {busy ? "Publicando contenido y esperando confirmación…" : "Publicar y anclar en Stellar"}
          </button>
        </form>
      )}
    </section>
  );
}
