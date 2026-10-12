/**
 * These tests exist because "Conectar cartera" used to do nothing.
 *
 * Two defects combined into that silence:
 *   1. `isAvailable()` imported the Freighter npm package and reported true.
 *      That package imports fine with no extension installed, so the app
 *      believed a wallet existed in browsers that have none.
 *   2. The connection failure was only surfaced when `available === false`, a
 *      state that never happened, and the header's own click handler discarded
 *      it with `.catch(() => {})`.
 *
 * The visible result was a dead button. `window.freighter` is the extension's
 * actual injection point, so that is what gets asserted here.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { freighterAdapter } from "./freighter.js";

type WindowWithFreighter = Window & { freighter?: unknown };

// `loadFreighter()` imports the package dynamically, so it has to be mocked the
// same way. The hoisted fns let each test pick what the extension answers.
const freighterMocks = vi.hoisted(() => ({
  isConnected: vi.fn(async () => true),
  getPublicKey: vi.fn(async () => "G" + "A".repeat(55)),
}));

vi.mock("@stellar/freighter-api", () => ({
  default: {
    isConnected: () => freighterMocks.isConnected(),
    getPublicKey: () => freighterMocks.getPublicKey(),
  },
}));

/** A minimal stand-in for what the extension injects into the page. */
function installFakeExtension() {
  (window as WindowWithFreighter).freighter = {};
}

function removeFakeExtension() {
  delete (window as WindowWithFreighter).freighter;
}

beforeEach(() => {
  removeFakeExtension();
  freighterMocks.isConnected.mockResolvedValue(true);
  freighterMocks.getPublicKey.mockResolvedValue("G" + "A".repeat(55));
  vi.restoreAllMocks();
});

describe("freighterAdapter — availability", () => {
  it("reports unavailable when the extension did not inject window.freighter", async () => {
    expect(await freighterAdapter.isAvailable()).toBe(false);
  });

  it("reports available only once the extension is present", async () => {
    installFakeExtension();
    expect(await freighterAdapter.isAvailable()).toBe(true);
  });

  // Importing the npm package is not evidence of an installed extension: it
  // resolves either way. That mistaken check is what made the button live.
  it("does not infer availability from the module being importable", async () => {
    await import("@stellar/freighter-api");
    removeFakeExtension();
    expect(await freighterAdapter.isAvailable()).toBe(false);
  });
});

describe("freighterAdapter — connect", () => {
  it("explains how to install Freighter when it is absent", async () => {
    await expect(freighterAdapter.connect()).rejects.toThrow(/no está instalada/i);
  });

  it("returns the address the extension reports", async () => {
    installFakeExtension();
    await expect(freighterAdapter.connect()).resolves.toBe("G" + "A".repeat(55));
  });

  it("rejects an answer that is not a Stellar address", async () => {
    installFakeExtension();
    freighterMocks.getPublicKey.mockResolvedValue("not-an-address");
    await expect(freighterAdapter.connect()).rejects.toThrow(/dirección pública válida/i);
  });

  // An extension that injects but never replies used to hang the promise
  // forever, which is indistinguishable from the button doing nothing.
  it("fails loudly instead of hanging when the extension never answers", async () => {
    vi.useFakeTimers();
    installFakeExtension();
    freighterMocks.getPublicKey.mockReturnValue(new Promise(() => {}));
    const attempt = freighterAdapter.connect().then(
      () => "resolved",
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    await vi.advanceTimersByTimeAsync(15_500);
    const outcome = await attempt;
    vi.useRealTimers();
    expect(outcome).toMatch(/no respondió|desbloqueada/i);
  });
});
