import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { verifyProposalContent } from "./content.js";
import { sha256Utf8 } from "@brugulacivica/sdk";

/** A chain record whose hashes match the payload returned below. */
const payload = {
  schema: "brujula-civica/proposal-content@1",
  title: "Presupuesto participativo 2026",
  description: "Destinar el 5% del presupuesto a proyectos elegidos por votación.",
  metadata: '{"district":"00"}',
  created_at: "2026-10-11T00:00:00.000Z",
};

async function anchored() {
  const [title_hash, description_hash, metadata_hash] = await Promise.all([
    sha256Utf8(payload.title),
    sha256Utf8(payload.description),
    sha256Utf8(payload.metadata),
  ]);
  return { content_cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi", title_hash, description_hash, metadata_hash };
}

const originalFetch = globalThis.fetch;

/** One fetch stub whose response the test picks, shared by every case. */
let responder: () => Promise<{ ok: boolean; status?: number; text: () => Promise<string> }>;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => responder()),
  );
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
});

describe("verifyProposalContent", () => {
  it("returns verified when the object parses and all three hashes match", async () => {
    responder = async () => ({ ok: true, text: async () => JSON.stringify(payload) });
    const verdict = await verifyProposalContent(await anchored());
    expect(verdict.status).toBe("verified");
    expect(verdict.status === "verified" && verdict.title).toBe(payload.title);
  });

  it("returns mismatch when a single hash differs", async () => {
    responder = async () => ({ ok: true, text: async () => JSON.stringify({ ...payload, title: "otro título" }) });
    const verdict = await verifyProposalContent(await anchored());
    expect(verdict.status).toBe("mismatch");
    expect(verdict.status === "mismatch" && /hashes/i.test(verdict.reason)).toBe(true);
  });

  it("returns mismatch when the object is not JSON", async () => {
    responder = async () => ({ ok: true, text: async () => "\uFFFD\uFFFD not json at all" });
    const verdict = await verifyProposalContent(await anchored());
    expect(verdict.status).toBe("mismatch");
  });

  it("returns mismatch when the object does not carry the schema", async () => {
    responder = async () => ({ ok: true, text: async () => JSON.stringify({ ...payload, schema: "otro" }) });
    const verdict = await verifyProposalContent(await anchored());
    expect(verdict.status).toBe("mismatch");
  });

  // This is the exact state of every deployed proposal: a JPEG, not a propuesta.
  it("returns mismatch, never verified, for an oversized object", async () => {
    responder = async () => ({ ok: true, text: async () => JSON.stringify({ ...payload, description: "x".repeat(70 * 1024) }) });
    const verdict = await verifyProposalContent(await anchored());
    expect(verdict.status).toBe("mismatch");
    expect(verdict.status === "mismatch" && /64 KiB/.test(verdict.reason)).toBe(true);
  });

  it("returns unknown, not mismatch, when no gateway answers", async () => {
    responder = async () => ({ ok: false, status: 504, text: async () => "" });
    const verdict = await verifyProposalContent(await anchored());
    expect(verdict.status).toBe("unknown");
  });

  it("returns unknown when the anchored CID is not a CID", async () => {
    responder = async () => ({ ok: true, text: async () => JSON.stringify(payload) });
    const record = await anchored();
    const verdict = await verifyProposalContent({ ...record, content_cid: "no-soy-un-cid" });
    expect(verdict.status).toBe("unknown");
    // A malformed CID must not even reach the network.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
