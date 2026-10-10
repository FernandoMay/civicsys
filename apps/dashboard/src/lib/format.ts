/**
 * Fail-closed rendering helpers.
 *
 * The single most important rule in this app (RFC BRUJULA-CIVICA-ARCH-001 §0):
 * when the chain did not answer, the UI says so. It must never fall back to `0`,
 * an empty list, a green badge, or an optimistic default.
 */

import type { Read } from "@brugulacivica/sdk";

/** The only text this app ever shows for an unreadable value. */
export const UNKNOWN = "DESCONOCIDO";

/** Render an `ok` read, or `null` when unknown — never a fabricated fallback. */
export function valueOrNull<T>(read: Read<T>): T | null {
  return read.status === "ok" ? read.value : null;
}

/** Render an `ok` read, or the explicit UNKNOWN marker. */
export function valueOrUnknown(read: Read<unknown>, format?: (v: unknown) => string): string {
  if (read.status !== "ok") return UNKNOWN;
  return format ? format(read.value) : String(read.value);
}

/** `bigint` → decimal string, `null` → UNKNOWN. */
export function bigOrUnknown(read: Read<bigint>): string {
  if (read.status !== "ok") return UNKNOWN;
  return read.value.toString();
}

/** Why a read failed, for the `reason` slot next to an UNKNOWN chip. */
export function reasonOf(read: Read<unknown>): string | null {
  return read.status === "unknown" ? read.reason : null;
}

/** Shorten a hash for display without pretending the rest is known. */
export function shortHash(hash: string | null | undefined, head = 10, tail = 6): string {
  if (!hash) return UNKNOWN;
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

/** Shorten an address, keeping both ends. */
export function shortAddress(address: string | null | undefined): string {
  if (!address) return UNKNOWN;
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** ISO timestamp → locale date, or UNKNOWN. Ledger timestamps are unix seconds. */
export function dateOrUnknown(unixSeconds: bigint | null | undefined): string {
  if (unixSeconds === null || unixSeconds === undefined) return UNKNOWN;
  const ms = Number(unixSeconds) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return UNKNOWN;
  return new Date(ms).toLocaleString();
}