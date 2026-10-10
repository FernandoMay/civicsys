/**
 * Retrieval and rule evaluation.
 *
 * These tests run against a REAL `node:http` server bound to an ephemeral port.
 * No `fetch` stub: a stub would only prove that Hermes calls the function it was
 * given, not that it handles a real response, a real redirect, a real 404 or a
 * real oversized body.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { retrieveSource, retrieveSources } from "../src/retrieve.js";
import { evaluateClaim, rollUpStatus } from "../src/rules.js";
import type { ClaimRule, EvidenceSet, RetrievedSource } from "../src/types.js";
import { sha256Utf8 } from "@brugulacivica/sdk";

let server: Server;
let origin = "";

const BIG = "x".repeat(200_000);

const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => void> = {
  "/ok.txt": (_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("El presupuesto aprobado es de 4200000 USD para la obra civil.");
  },
  "/other.txt": (_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("El presupuesto aprobado es de 4200000 USD. Firma el director.");
  },
  "/different-amount.txt": (_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("El presupuesto aprobado es de 3100000 USD. Firma el director.");
  },
  "/empty.txt": (_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("");
  },
  "/binary.png": (_req, res) => {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  },
  "/big.txt": (_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(BIG);
  },
  "/redirect": (_req, res) => {
    res.writeHead(302, { location: "/ok.txt" });
    res.end();
  },
  "/404": (_req, res) => {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("no such document");
  },
  "/500": (_req, res) => {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("server on fire");
  },
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const route = routes[path];
    if (route) route(req, res);
    else {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const url = (p: string) => `${origin}${p}`;

function rule(over: Partial<ClaimRule> = {}): ClaimRule {
  return {
    id: "budget-amount",
    description: "El presupuesto aprobado figura en la fuente",
    claim: "4200000 USD",
    ...over,
  };
}

function evidence(...sources: RetrievedSource[]): EvidenceSet {
  return { subject: "test", sources };
}

describe("retrieveSource against a real HTTP server", () => {
  it("retrieves a text body and hashes exactly what was served", async () => {
    const s = await retrieveSource(url("/ok.txt"));
    expect(s.status).toBe("RETRIEVED");
    expect(s.httpStatus).toBe(200);
    expect(s.text).toContain("4200000 USD");
    expect(s.contentHash).toBe(await sha256Utf8(s.text!));
    expect(s.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(s.error).toBeNull();
    expect(s.byteLength).toBeGreaterThan(0);
  });

  it("records the redirect target in finalUrl", async () => {
    const s = await retrieveSource(url("/redirect"));
    expect(s.status).toBe("RETRIEVED");
    expect(s.finalUrl).toBe(url("/ok.txt"));
    expect(s.url).toBe(url("/redirect"));
  });

  it("reports a 404 as HTTP_ERROR, not as an empty document", async () => {
    const s = await retrieveSource(url("/404"));
    expect(s.status).toBe("HTTP_ERROR");
    expect(s.httpStatus).toBe(404);
    expect(s.text).toBeNull();
    expect(s.contentHash).toBeNull();
    expect(s.error).toMatch(/HTTP 404/);
  });

  it("reports a 500 as HTTP_ERROR", async () => {
    const s = await retrieveSource(url("/500"));
    expect(s.status).toBe("HTTP_ERROR");
    expect(s.httpStatus).toBe(500);
    expect(s.contentHash).toBeNull();
  });

  it("refuses a non-textual content type instead of decoding bytes as text", async () => {
    const s = await retrieveSource(url("/binary.png"));
    expect(s.status).toBe("UNSUPPORTED_TYPE");
    expect(s.contentType).toMatch(/image\/png/);
    expect(s.contentHash).toBeNull();
  });

  it("enforces the size ceiling and reports TOO_LARGE", async () => {
    const s = await retrieveSource(url("/big.txt"), { maxBytes: 1000 });
    expect(s.status).toBe("TOO_LARGE");
    expect(s.error).toMatch(/límite 1000/);
    expect(s.contentHash).toBeNull();
  });

  it("reports a connection failure as NETWORK_ERROR, never as absent evidence", async () => {
    // Port 1 on loopback refuses connections.
    const s = await retrieveSource("http://127.0.0.1:1/nope");
    expect(s.status).toBe("NETWORK_ERROR");
    expect(s.contentHash).toBeNull();
    expect(s.error).toBeTruthy();
  });

  it("rejects a non-http scheme", async () => {
    const s = await retrieveSource("file:///etc/passwd");
    expect(s.status).toBe("UNSUPPORTED_TYPE");
    expect(s.error).toMatch(/esquema/);
  });

  it("rejects a malformed URL without touching the network", async () => {
    const s = await retrieveSource("not a url");
    expect(s.status).toBe("NETWORK_ERROR");
    expect(s.error).toMatch(/URL inválida/);
  });

  it("times out a slow response", async () => {
    const slow = createServer(() => {
      /* never respond */
    });
    await new Promise<void>((r) => slow.listen(0, "127.0.0.1", r));
    const port = (slow.address() as AddressInfo).port;
    const s = await retrieveSource(`http://127.0.0.1:${port}/slow`, { timeoutMs: 150 });
    expect(s.status).toBe("TIMEOUT");
    await new Promise<void>((r) => slow.close(() => r()));
  });
});

describe("retrieveSources ordering", () => {
  it("preserves input order even when concurrent", async () => {
    const out = await retrieveSources(
      [url("/ok.txt"), url("/404"), url("/other.txt"), url("/500")],
      { concurrency: 4 },
    );
    expect(out.map((s) => s.status)).toEqual([
      "RETRIEVED",
      "HTTP_ERROR",
      "RETRIEVED",
      "HTTP_ERROR",
    ]);
    expect(out[0]!.url).toBe(url("/ok.txt"));
    expect(out[2]!.url).toBe(url("/other.txt"));
  });
});

describe("evaluateClaim", () => {
  it("SUPPORTED when one retrieved source contains the claim", async () => {
    const e = evidence(await retrieveSource(url("/ok.txt")));
    const f = evaluateClaim(e, rule());
    expect(f.status).toBe("SUPPORTED");
    expect(f.matchedSourceIndices).toEqual([0]);
    expect(f.retrievedSourceCount).toBe(1);
    expect(f.ruleId).toBe("budget-amount");
  });

  it("requires independent corroboration when minSources > 1", async () => {
    const e = evidence(
      await retrieveSource(url("/ok.txt")),
      await retrieveSource(url("/other.txt")),
    );
    expect(evaluateClaim(e, rule({ minSources: 2 })).status).toBe("SUPPORTED");
    // The same two sources cannot corroborate a rule demanding three.
    expect(evaluateClaim(e, rule({ minSources: 3 })).status).toBe("UNVERIFIED");
  });

  it("CONTRADICTED only when enough sources were retrievable and none matched", async () => {
    // Both sources retrieved, both quote a different figure: the claim is
    // contradicted *by the sources*. This is a statement about the sources,
    // not a judgement about the world.
    const e = evidence(
      await retrieveSource(url("/different-amount.txt")),
      await retrieveSource(url("/empty.txt")),
    );
    const f = evaluateClaim(e, rule());
    expect(f.status).toBe("CONTRADICTED");
    expect(f.matchedSourceIndices).toEqual([]);
    expect(f.retrievedSourceCount).toBe(2);
  });

  it("CONTRADICTED when a single retrieved source refutes the claim", async () => {
    const e = evidence(await retrieveSource(url("/different-amount.txt")));
    expect(evaluateClaim(e, rule()).status).toBe("CONTRADICTED");
  });

  it("UNVERIFIED — never CONTRADICTED — when every source failed", async () => {
    // This is the fail-closed core: unreachable sources must not be read as
    // "the sources do not say this".
    const e = evidence(await retrieveSource(url("/404")), await retrieveSource(url("/500")));
    const f = evaluateClaim(e, rule({ minSources: 1 }));
    expect(f.status).toBe("UNVERIFIED");
    expect(f.retrievedSourceCount).toBe(0);
    expect(f.detail).toMatch(/ninguna fuente/);
  });

  it("ignores typographic noise (non-breaking space) when matching", async () => {
    const nbsp = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("presupuesto 4200000 USD");
    });
    await new Promise<void>((r) => nbsp.listen(0, "127.0.0.1", r));
    const port = (nbsp.address() as AddressInfo).port;
    const s = await retrieveSource(`http://127.0.0.1:${port}/x`);
    expect(evaluateClaim(evidence(s), rule()).status).toBe("SUPPORTED");
    await new Promise<void>((r) => nbsp.close(() => r()));
  });

  it("rejects an empty claim string rather than matching everything", () => {
    expect(() => evaluateClaim(evidence(), rule({ claim: "" }))).toThrow(/vacío/);
  });
});

describe("rollUpStatus", () => {
  const finding = (status: "SUPPORTED" | "CONTRADICTED" | "UNVERIFIED" | "UNKNOWN") => ({
    claim: "c",
    status,
    ruleId: "r",
    ruleDescription: "d",
    matchedSourceIndices: [],
    retrievedSourceCount: 0,
    detail: "",
  });

  it("lets a single contradiction outweigh many supports", () => {
    const r = rollUpStatus([
      finding("SUPPORTED"),
      finding("SUPPORTED"),
      finding("SUPPORTED"),
      finding("CONTRADICTED"),
    ]);
    expect(r).toBe("CONTRADICTED");
  });

  it("reports UNVERIFIED when nothing was decidable", () => {
    expect(rollUpStatus([finding("SUPPORTED"), finding("UNVERIFIED")])).toBe("UNVERIFIED");
  });

  it("is UNKNOWN for an empty rule set rather than SUPPORTED", () => {
    // Zero claims must never be reported as a clean bill of health.
    expect(rollUpStatus([])).toBe("UNKNOWN");
  });
});