/**
 * Canonical JSON.
 *
 * The evidence hash anchored on chain is `H(canonical JSON of the evidence
 * set)`. For that hash to mean anything, two independent parties serialising the
 * same data must produce the same bytes. `JSON.stringify` does not guarantee
 * that: object key order follows insertion order.
 *
 * This serializer is therefore deliberately narrow and total:
 *
 *   - object keys are emitted in ascending UTF-16 code-unit order;
 *   - no insignificant whitespace;
 *   - `undefined` properties are omitted, `null` is preserved;
 *   - numbers must be finite and safely representable, or serialisation throws;
 *   - cycles throw instead of producing a truncated string.
 *
 * Following the shape of RFC 8785 (JSON Canonicalization Scheme) rather than
 * inventing a private format, so a third party can reproduce it.
 */

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json | undefined };

/** Thrown when a value cannot be canonically serialised. Never swallowed. */
export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

const ESCAPES: Record<string, string> = {
  '"': '\\"',
  "\\": "\\\\",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

function serializeString(value: string): string {
  let out = '"';
  for (const ch of value) {
    const esc = ESCAPES[ch];
    if (esc !== undefined) {
      out += esc;
    } else if (ch < " ") {
      out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
    } else {
      out += ch;
    }
  }
  return `${out}"`;
}

function serializeNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalJsonError(`non-finite number at ${path}: ${String(value)}`);
  }
  // -0 and 0 must serialise identically or the hash would depend on sign.
  if (Object.is(value, -0)) return "0";
  if (!Number.isInteger(value)) {
    throw new CanonicalJsonError(
      `non-integer number at ${path}: ${String(value)} (canonical form requires integers)`,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new CanonicalJsonError(`unsafe integer at ${path}: ${String(value)}`);
  }
  return String(value);
}

function serialize(value: Json | undefined, path: string, seen: Set<object>): string {
  if (value === undefined) return "null";
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return serializeNumber(value, path);
    case "bigint":
      throw new CanonicalJsonError(
        `bigint at ${path}: encode it as a decimal string, bigints are not JSON`,
      );
    case "string":
      return serializeString(value);
    default:
      break;
  }

  const obj = value as object;
  if (seen.has(obj)) {
    throw new CanonicalJsonError(`circular reference at ${path}`);
  }
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const parts = obj.map((item, i) => serialize(item as Json, `${path}[${i}]`, seen));
      return `[${parts.join(",")}]`;
    }
    if (Object.getPrototypeOf(obj) !== Object.prototype && Object.getPrototypeOf(obj) !== null) {
      throw new CanonicalJsonError(
        `only plain objects are canonical (${path} is ${Object.getPrototypeOf(obj)?.constructor?.name ?? "unknown"})`,
      );
    }
    const keys = Object.keys(obj as Record<string, Json | undefined>)
      .filter((k) => (obj as Record<string, Json | undefined>)[k] !== undefined)
      .sort();
    const parts = keys.map(
      (k) => `${serializeString(k)}:${serialize((obj as Record<string, Json | undefined>)[k], `${path}.${k}`, seen)}`,
    );
    return `{${parts.join(",")}}`;
  } finally {
    seen.delete(obj);
  }
}

/** Canonical JSON text. Throws `CanonicalJsonError` on anything unrepresentable. */
export function canonicalize(value: Json): string {
  return serialize(value, "$", new Set());
}