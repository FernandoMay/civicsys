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
  it("reports unavailable when the extension never answers a probe", async () => {
    freighterMocks.isConnected.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers();
    const probe = freighterAdapter.isAvailable();
    await vi.advanceTimersByTimeAsync(5_500);
    const available = await probe;
    vi.useRealTimers();
    expect(available).toBe(false);
  });

  it("reports available when the extension answers, even if it answers false", async () => {
    // `isConnected() === false` means installed but not yet authorised for this
    // site. That is still an installed extension, and saying otherwise hides a
    // wallet that works.
    freighterMocks.isConnected.mockResolvedValue(false);
    expect(await freighterAdapter.isAvailable()).toBe(true);
  });

  it("reports available when the build has no isConnected at all", async () => {
    // Some versions omit it; the other calls still work.
    expect(await freighterAdapter.isAvailable()).toBe(true);
  });

  // Regression guard for the fix that broke this: the package treats
  // window.freighter as a shortcut, not a requirement, so its absence says
  // nothing about whether the extension is installed.
  it("does not gate availability on window.freighter being present", async () => {
    installFakeExtension();
    removeFakeExtension();
    freighterMocks.isConnected.mockResolvedValue(true);
    expect(await freighterAdapter.isAvailable()).toBe(true);
  });
});

describe("freighterAdapter — connect", () => {
  it("connects when the extension answers, without needing window.freighter", async () => {
    // The exact scenario the previous regression broke: an extension that
    // works over postMessage and never injects the shortcut object.
    await expect(freighterAdapter.connect()).resolves.toBe("G" + "A".repeat(55));
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
