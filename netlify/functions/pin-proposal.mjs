const MAX_CONTENT_BYTES = 64 * 1024;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_UPLOADS_PER_WINDOW = 10;
const uploadsByIp = new Map();

function response(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

/**
 * Reports what can be known about publishing without publishing anything.
 *
 * `ready: null` is the honest answer for the common case, and it is not a
 * hedge. Pinata's `testAuthentication` answers one question — is this token a
 * real, active one — and not the question that matters, which is whether it
 * carries the `pinFileToIPFS` permission. A token with no scopes at all passes
 * authentication and is refused at upload time with `NO_SCOPES_FOUND`.
 *
 * That was measured in production: the probe answered 200 while the real upload
 * was rejected. So a probe that turned "the token is real" into "publishing
 * works" would put a false VERIFICABLE on the screen, which is the one thing
 * this panel must never do. Determining the permission needs a write, and this
 * probe does not write.
 */
async function capability() {
  const token = process.env.PINATA_JWT;
  if (!token) {
    return response(200, {
      ready: false,
      configured: false,
      reason: "Falta PINATA_JWT en el entorno de funciones.",
    });
  }
  let upstream;
  try {
    upstream = await fetch("https://api.pinata.cloud/data/testAuthentication", {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return response(200, {
      ready: false,
      configured: true,
      reason: "PINATA_JWT está configurada, pero el proveedor IPFS no respondió.",
    });
  }
  if (!upstream.ok) {
    const body = await upstream.text().catch(() => "");
    // If the provider ever does refuse the probe for lack of scopes, name the
    // permission: "the key was rejected" leaves the operator guessing.
    return response(200, {
      ready: false,
      configured: true,
      reason: /NO_SCOPES_FOUND/.test(body)
        ? "PINATA_JWT está configurada, pero la clave no tiene el permiso pinFileToIPFS."
        : "PINATA_JWT está configurada, pero el proveedor rechazó la clave.",
    });
  }
  // The token is real. Whether it may pin is a different question, and it has no
  // read-only answer.
  return response(200, {
    ready: null,
    configured: true,
    reason:
      "PINATA_JWT está configurada y el proveedor la reconoce. Si la clave no tiene el permiso pinFileToIPFS la publicación será rechazada; eso solo se comprueba al publicar, no con una lectura.",
  });
}

export async function handler(event) {
  // A read-only capability report. The status panel used to hardcode
  // "needs_config: set PINATA_JWT", which stayed on screen even once the secret
  // was present and the real blocker was the key's scope — telling the operator
  // to do something already done. This reports what is actually true instead.
  // It never echoes the token and never pins anything.
  if (event.httpMethod === "GET") return capability();

  if (event.httpMethod !== "POST") return response(405, { error: "Método no permitido." });

  const origin = event.headers?.origin;
  const host = event.headers?.host;
  if (!origin || !host) return response(403, { error: "Origen no válido." });
  try {
    if (new URL(origin).host !== host) return response(403, { error: "Origen no permitido." });
  } catch {
    return response(403, { error: "Origen no válido." });
  }

  const ip = event.headers?.["x-nf-client-connection-ip"] ?? event.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  // Drop expired buckets so a warm function instance does not retain old IPs forever.
  for (const [key, value] of uploadsByIp) {
    if (now - value.startedAt >= WINDOW_MS) uploadsByIp.delete(key);
  }
  const entry = uploadsByIp.get(ip);
  if (!entry || now - entry.startedAt >= WINDOW_MS) {
    uploadsByIp.set(ip, { startedAt: now, count: 1 });
  } else if (entry.count >= MAX_UPLOADS_PER_WINDOW) {
    return response(429, { error: "Límite temporal de publicaciones alcanzado. Inténtalo más tarde." });
  } else {
    entry.count += 1;
  }

  // NOTE: the configuration check runs AFTER the request has been validated.
  // Checking it first made every malformed request look like a 503 ("falta
  // PINATA_JWT"), so a client could never learn what was actually wrong with
  // its payload. Cheap input validation must not be masked by a missing secret.
  let body;
  try {
    body = JSON.parse(event.body ?? "");
  } catch {
    return response(400, { error: "Cuerpo JSON inválido." });
  }
  if (typeof body?.content !== "string") return response(400, { error: "Falta el contenido serializado." });
  const byteLength = Buffer.byteLength(body.content, "utf8");
  if (byteLength < 2 || byteLength > MAX_CONTENT_BYTES) {
    return response(413, { error: `El contenido debe ocupar entre 2 y ${MAX_CONTENT_BYTES} bytes.` });
  }

  let content;
  try {
    content = JSON.parse(body.content);
  } catch {
    return response(400, { error: "El contenido de la propuesta no es JSON válido." });
  }
  if (
    content?.schema !== "brujula-civica/proposal-content@1" ||
    typeof content.title !== "string" ||
    typeof content.description !== "string" ||
    typeof content.metadata !== "string" ||
    typeof content.created_at !== "string"
  ) {
    return response(400, { error: "El contenido no cumple brujula-civica/proposal-content@1." });
  }

  const token = process.env.PINATA_JWT;
  if (!token) return response(503, { error: "Publicación IPFS no configurada: falta PINATA_JWT en el entorno de funciones." });

  const form = new FormData();
  form.append("file", new Blob([body.content], { type: "application/json" }), "proposal.json");
  form.append("pinataMetadata", JSON.stringify({
    name: `brujula-civica-proposal-${Date.now()}`,
    keyvalues: { schema: "brujula-civica/proposal-content@1" },
  }));

  let upstream;
  try {
    upstream = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch {
    return response(502, { error: "No se pudo conectar con el proveedor IPFS." });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return response(502, {
      error: "El proveedor IPFS rechazó la publicación.",
      detail: detail.slice(0, 300),
    });
  }

  let pinned;
  try {
    pinned = await upstream.json();
  } catch {
    return response(502, { error: "El proveedor IPFS devolvió una respuesta inválida." });
  }
  if (typeof pinned?.IpfsHash !== "string" || !(/^b[a-z2-7]{20,}$/.test(pinned.IpfsHash) || /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(pinned.IpfsHash))) {
    return response(502, { error: "El proveedor no devolvió un CID válido." });
  }

  return response(200, { cid: pinned.IpfsHash, size: byteLength, schema: content.schema });
}
