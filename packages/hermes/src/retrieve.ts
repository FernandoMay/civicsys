/**
 * Source retrieval.
 *
 * The only place Hermes touches the network. Every failure mode is recorded on
 * the `RetrievedSource` rather than thrown away, because a source that could not
 * be fetched must not silently become "no evidence either way" — it must force
 * its dependent claims to UNVERIFIED (RFC §6).
 *
 * There is no caching layer pretending to be fresh: a caller that wants a
 * content-addressed, re-fetchable body keeps the `contentHash` and can verify
 * the source independently later.
 */

import { sha256Utf8 } from "@brugulacivica/sdk";
import type { RetrievedSource, RetrievalStatus } from "./types.js";

export interface RetrieveOptions {
  /** Abort the request after this many milliseconds. */
  timeoutMs?: number;
  /** Reject bodies larger than this, as TOO_LARGE. */
  maxBytes?: number;
  /** Extra headers (e.g. an Authorization header for a private mirror). */
  headers?: Record<string, string>;
  /** Injected fetch, so callers can supply their own agent/proxy. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

const TEXTUAL = /^(text\/|application\/(json|xml|javascript|xhtml\+xml)|application\/.*\+xml)/i;

function httpDateToIso(value: string | null): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function failure(
  url: string,
  status: RetrievalStatus,
  detail: string,
  extra: Partial<RetrievedSource> = {},
): RetrievedSource {
  return {
    url,
    finalUrl: extra.finalUrl ?? url,
    status,
    httpStatus: extra.httpStatus ?? null,
    retrievedAt: extra.retrievedAt ?? null,
    contentHash: null,
    text: null,
    contentType: extra.contentType ?? null,
    byteLength: null,
    error: detail,
  };
}

/** Fetch one source and describe exactly what happened. Never throws. */
export async function retrieveSource(
  url: string,
  opts: RetrieveOptions = {},
): Promise<RetrievedSource> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    headers = {},
    fetchImpl = fetch,
  } = opts;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return failure(url, "NETWORK_ERROR", `URL inválida: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return failure(url, "UNSUPPORTED_TYPE", `esquema no soportado: ${parsed.protocol}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "brujula-civica-hermes/0.2 (+evidence-retrieval)", ...headers },
    });
  } catch (e) {
    const aborted = controller.signal.aborted;
    return failure(
      url,
      aborted ? "TIMEOUT" : "NETWORK_ERROR",
      aborted ? `timeout tras ${timeoutMs} ms` : `fallo de red: ${describe(e)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  const finalUrl = response.url || url;
  const retrievedAt = httpDateToIso(response.headers.get("date"));
  const contentType = response.headers.get("content-type");

  if (!response.ok) {
    return failure(finalUrl, "HTTP_ERROR", `HTTP ${response.status}`, {
      finalUrl,
      httpStatus: response.status,
      retrievedAt,
      contentType,
    });
  }

  if (contentType && !TEXTUAL.test(contentType)) {
    return failure(finalUrl, "UNSUPPORTED_TYPE", `tipo no textual: ${contentType}`, {
      finalUrl,
      httpStatus: response.status,
      retrievedAt,
      contentType,
    });
  }

  let body: ArrayBuffer;
  try {
    body = await response.arrayBuffer();
  } catch (e) {
    return failure(finalUrl, "NETWORK_ERROR", `cuerpo ilegible: ${describe(e)}`, {
      finalUrl,
      httpStatus: response.status,
      retrievedAt,
      contentType,
    });
  }

  if (body.byteLength > maxBytes) {
    return failure(
      finalUrl,
      "TOO_LARGE",
      `cuerpo de ${body.byteLength} bytes > límite ${maxBytes}`,
      { finalUrl, httpStatus: response.status, retrievedAt, contentType },
    );
  }

  const text = new TextDecoder("utf-8", { fatal: false }).decode(body);
  return {
    url,
    finalUrl,
    status: "RETRIEVED",
    httpStatus: response.status,
    retrievedAt,
    contentHash: await sha256Utf8(text),
    text,
    contentType,
    byteLength: body.byteLength,
    error: null,
  };
}

/**
 * Retrieve many sources.
 *
 * Sequential by default: the public sources are frequently rate-limited and a
 * burst would turn real evidence into retrieval failures, which would silently
 * degrade every dependent claim to UNVERIFIED.
 */
export async function retrieveSources(
  urls: readonly string[],
  opts: RetrieveOptions & { concurrency?: number } = {},
): Promise<RetrievedSource[]> {
  const { concurrency = 3, ...rest } = opts;
  if (concurrency <= 1) {
    const out: RetrievedSource[] = [];
    for (const u of urls) out.push(await retrieveSource(u, rest));
    return out;
  }

  const results: RetrievedSource[] = new Array(urls.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= urls.length) return;
      results[i] = await retrieveSource(urls[i]!, rest);
    }
  });
  await Promise.all(workers);
  return results;
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}