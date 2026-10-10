/**
 * Content hashing.
 *
 * Uses WebCrypto (`crypto.subtle`), which is present in Node >= 20, browsers,
 * Deno and Bun. This keeps the SDK dependency-free and usable from the
 * dashboard bundle as well as from Node scripts.
 *
 * RFC BRUJULA-CIVICA-ARCH-001 §1: aggregates store *hashes of content*, never
 * the content itself. These helpers are the single place that hashing is done,
 * so a report and the verifier can never disagree about a digest.
 */

const HEX = "0123456789abcdef";

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += HEX[b >>> 4]! + HEX[b & 15]!;
  return out;
}

/** `crypto.subtle` in whichever global this runtime exposes. */
function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error(
      "WebCrypto (crypto.subtle) is unavailable in this runtime; Node >= 20 or a browser is required",
    );
  }
  return c.subtle;
}

export function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Lowercase hex SHA-256 of raw bytes. */
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer: `subtle.digest` rejects views whose
  // underlying buffer is shared/offset in some runtimes.
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return toHex(new Uint8Array(await subtle().digest("SHA-256", buf)));
}

/** Lowercase hex SHA-256 of a UTF-8 string. */
export async function sha256Utf8(text: string): Promise<string> {
  return sha256Bytes(utf8Bytes(text));
}

/** Lowercase hex SHA-256 of a hex string interpreted as bytes. */
export async function sha256Hex(hex: string): Promise<string> {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error(`not a hex string: ${JSON.stringify(hex.slice(0, 32))}`);
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return sha256Bytes(bytes);
}

/** `true` when `digest` is a 64-character lowercase hex string. */
export function isSha256Hex(digest: unknown): digest is string {
  return typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest);
}