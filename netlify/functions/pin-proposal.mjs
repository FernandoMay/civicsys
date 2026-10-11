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

export async function handler(event) {
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
  const entry = uploadsByIp.get(ip);
  if (!entry || now - entry.startedAt >= WINDOW_MS) {
    uploadsByIp.set(ip, { startedAt: now, count: 1 });
  } else if (entry.count >= MAX_UPLOADS_PER_WINDOW) {
    return response(429, { error: "Límite temporal de publicaciones alcanzado. Inténtalo más tarde." });
  } else {
    entry.count += 1;
  }

  const token = process.env.PINATA_JWT;
  if (!token) return response(503, { error: "Publicación IPFS no configurada: falta PINATA_JWT en el entorno de funciones." });

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
  if (typeof pinned?.IpfsHash !== "string" || !pinned.IpfsHash.startsWith("bafy")) {
    return response(502, { error: "El proveedor no devolvió un CID válido." });
  }

  return response(200, { cid: pinned.IpfsHash, size: byteLength, schema: content.schema });
}
