import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";

import { handler } from "../../netlify/functions/pin-proposal.mjs";

const ORIGIN = "https://civicsys.netlify.app";
const HOST = "civicsys.netlify.app";

/** One CIDv1 (bafy…) and one CIDv0 (Qm…), since both are accepted upstream. */
const CIDV1 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const CIDV0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

// The function rate-limits per client IP, and the in-memory bucket is shared by
// every test in this file (all of them arrive with no forwarding headers, so
// the handler buckets them all under "unknown"). Give each call its own IP so a
// test's budget does not leak into the next one.
let nextIp = 0;
function withOwnIp(overrides = {}) {
  nextIp += 1;
  return event({ ...overrides, headers: { "x-forwarded-for": `10.0.0.${nextIp % 250}`, ...overrides.headers } });
}

function event(overrides = {}) {
  return {
    httpMethod: "POST",
    headers: { origin: ORIGIN, host: HOST, ...overrides.headers },
    body: overrides.body,
  };
}

/** A payload that satisfies `brujula-civica/proposal-content@1`. */
function validContent() {
  return JSON.stringify({
    schema: "brujula-civica/proposal-content@1",
    title: "Título",
    description: "Descripción",
    metadata: "{}",
    created_at: new Date().toISOString(),
  });
}

function bodyOf(res) {
  return JSON.parse(res.body);
}

// The function runs in the same Node runtime as this test, so a global fetch
// stub is exactly the seam the handler uses to reach the provider.
const originalFetch = globalThis.fetch;
const originalToken = process.env.PINATA_JWT;
let fetchMock;
let calls;

function stubFetch(impl) {
  calls = [];
  fetchMock = mock.fn(async (...args) => {
    calls.push(args);
    return impl(...args);
  });
  globalThis.fetch = fetchMock;
}

beforeEach(() => {
  process.env.PINATA_JWT = "test-token";
});

after(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.PINATA_JWT;
  else process.env.PINATA_JWT = originalToken;
});

describe("pin-proposal — request validation", () => {
  it("rejects a method that is neither GET nor POST", async () => {
    const res = await handler({ ...event(), httpMethod: "DELETE" });
    assert.equal(res.statusCode, 405);
  });

  it("rejects a cross-origin caller", async () => {
    const res = await handler(event({ headers: { origin: "https://evil.example.com" } }));
    assert.equal(res.statusCode, 403);
  });

  it("rejects a malformed origin", async () => {
    const res = await handler(event({ headers: { origin: "not-a-url" } }));
    assert.equal(res.statusCode, 403);
  });

  it("rejects a body that is not JSON", async () => {
    const res = await handler(withOwnIp({ body: "definitely not json" }));
    assert.equal(res.statusCode, 400);
  });

  it("rejects a payload without content", async () => {
    const res = await handler(withOwnIp({ body: "{}" }));
    assert.equal(res.statusCode, 400);
  });

  it("rejects content that is not the proposal schema", async () => {
    const res = await handler(withOwnIp({ body: JSON.stringify({ content: JSON.stringify({ schema: "otro" }) }) }));
    assert.equal(res.statusCode, 400);
    assert.match(bodyOf(res).error, /brujula-civica\/proposal-content@1/);
  });

  it("rejects content larger than 64 KiB", async () => {
    const huge = JSON.stringify({
      schema: "brujula-civica/proposal-content@1",
      title: "T",
      description: "x".repeat(70 * 1024),
      metadata: "{}",
      created_at: new Date().toISOString(),
    });
    const res = await handler(withOwnIp({ body: JSON.stringify({ content: huge }) }));
    assert.equal(res.statusCode, 413);
  });
});

describe("pin-proposal — configuration", () => {
  it("returns 503 without PINATA_JWT, and never calls the provider", async () => {
    delete process.env.PINATA_JWT;
    stubFetch(() => ({ ok: true, json: async () => ({ IpfsHash: CIDV1 }) }));
    const res = await handler(withOwnIp({ body: JSON.stringify({ content: validContent() }) }));
    assert.equal(res.statusCode, 503);
    assert.equal(calls.length, 0);
  });

  // Regression guard: the token check used to run BEFORE request validation, so
  // every malformed request was reported as a 503 configuration error and the
  // client could never learn what was wrong with its own payload.
  it("still reports a 400 for a bad payload even when the token is missing", async () => {
    delete process.env.PINATA_JWT;
    stubFetch(() => ({ ok: true, json: async () => ({ IpfsHash: CIDV1 }) }));
    const res = await handler(withOwnIp({ body: "no soy json" }));
    assert.equal(res.statusCode, 400);
    assert.equal(calls.length, 0);
  });
});

describe("pin-proposal — upstream", () => {
  it("returns the CID when the provider accepts the upload", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ IpfsHash: CIDV1 }) }));
    const res = await handler(withOwnIp({ body: JSON.stringify({ content: validContent() }) }));
    assert.equal(res.statusCode, 200);
    assert.equal(bodyOf(res).cid, CIDV1);
    assert.equal(calls.length, 1);
    // The credential goes to the provider, never back to the caller.
    assert.ok(!res.body.includes("test-token"));
    assert.equal(bodyOf(res).token, undefined);
  });

  it("accepts a CIDv0 too", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ IpfsHash: CIDV0 }) }));
    const res = await handler(withOwnIp({ body: JSON.stringify({ content: validContent() }) }));
    assert.equal(res.statusCode, 200);
    assert.equal(bodyOf(res).cid, CIDV0);
  });

  it("rejects a provider response with a malformed CID", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ IpfsHash: "not-a-cid" }) }));
    const res = await handler(withOwnIp({ body: JSON.stringify({ content: validContent() }) }));
    assert.equal(res.statusCode, 502);
  });

  it("surfaces a provider rejection as 502 without leaking the payload", async () => {
    stubFetch(async () => ({ ok: false, text: async () => "upstream said no" }));
    const res = await handler(withOwnIp({ body: JSON.stringify({ content: validContent() }) }));
    assert.equal(res.statusCode, 502);
    assert.equal(bodyOf(res).detail, "upstream said no");
  });

  it("returns 502 when the provider cannot be reached", async () => {
    stubFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const res = await handler(withOwnIp({ body: JSON.stringify({ content: validContent() }) }));
    assert.equal(res.statusCode, 502);
  });
});

// The status panel reads this instead of asserting a fixed reason in the UI.
// It had said "set PINATA_JWT" long after the secret was in place, when the
// real blocker was the key's scope, so the operator was sent to fix something
// already done.
describe("pin-proposal — capability probe (GET)", () => {
  it("reports the secret as missing, and never calls the provider", async () => {
    delete process.env.PINATA_JWT;
    stubFetch(async () => {
      throw new Error("must not be called");
    });
    const res = await handler({ ...event(), httpMethod: "GET" });
    assert.equal(res.statusCode, 200);
    assert.equal(bodyOf(res).ready, false);
    assert.equal(bodyOf(res).configured, false);
    assert.match(bodyOf(res).reason, /Falta PINATA_JWT/);
    assert.equal(calls.length, 0);
  });

  // The measured failure: a token with no scopes passes authentication and is
  // refused at upload. Turning that into ready:true put a false VERIFICABLE on
  // the screen, so the probe reports what it actually knows.
  it("does not claim publishing works when only authentication was proven", async () => {
    process.env.PINATA_JWT = "test-token";
    stubFetch(async () => ({ ok: true, text: async () => "" }));
    const res = await handler({ ...event(), httpMethod: "GET" });
    assert.equal(bodyOf(res).ready, null);
    assert.equal(bodyOf(res).configured, true);
    assert.match(bodyOf(res).reason, /pinFileToIPFS/);
    // Read-only: a probe must never pin anything.
    assert.equal(calls[0][0], "https://api.pinata.cloud/data/testAuthentication");
  });

  // The failure that actually happened in production.
  it("distinguishes a configured key that lacks the pinning scope", async () => {
    process.env.PINATA_JWT = "test-token";
    stubFetch(async () => ({
      ok: false,
      text: async () => '{"error":{"reason":"NO_SCOPES_FOUND"}}',
    }));
    const res = await handler({ ...event(), httpMethod: "GET" });
    assert.equal(bodyOf(res).configured, true);
    assert.equal(bodyOf(res).ready, false);
    assert.match(bodyOf(res).reason, /pinFileToIPFS/);
  });

  it("never echoes the token", async () => {
    process.env.PINATA_JWT = "test-token";
    stubFetch(async () => ({ ok: false, text: async () => "nope" }));
    const res = await handler({ ...event(), httpMethod: "GET" });
    assert.ok(!res.body.includes("test-token"));
  });

  it("says the provider is unreachable without blaming the secret", async () => {
    process.env.PINATA_JWT = "test-token";
    stubFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const res = await handler({ ...event(), httpMethod: "GET" });
    assert.equal(bodyOf(res).configured, true);
    assert.equal(bodyOf(res).ready, false);
    assert.match(bodyOf(res).reason, /no respondió/);
  });
});
