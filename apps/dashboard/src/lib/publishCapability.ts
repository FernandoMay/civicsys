/**
 * Whether the publish function can actually pin, read from the function itself.
 *
 * The panel used to hardcode "needs_config: set PINATA_JWT". It kept saying
 * that long after the secret was present, when the real blocker was the key's
 * scope, which sent the operator to do something already done. A status light
 * nobody reads is worse than no status light.
 *
 * The probe is read-only: it never pins anything and never returns the token.
 */

import { useEffect, useState } from "react";

export type PublishCapability =
  | { status: "loading" }
  | { status: "unknown"; reason: string }
  | { status: "ok"; ready: boolean; configured: boolean; reason: string };

type ProbeResponse = { ready?: boolean; configured?: boolean; reason?: string };

export function usePublishCapability(): PublishCapability {
  const [state, setState] = useState<PublishCapability>({ status: "loading" });

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    void (async () => {
      try {
        const res = await fetch("/.netlify/functions/pin-proposal", {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        const body = (await res.json().catch(() => null)) as ProbeResponse | null;
        if (!live) return;
        if (!res.ok || !body || typeof body.ready !== "boolean") {
          setState({
            status: "unknown",
            reason: "No se pudo consultar el estado del servicio de publicación.",
          });
          return;
        }
        setState({
          status: "ok",
          ready: body.ready,
          configured: body.configured === true,
          reason: body.reason ?? "",
        });
      } catch {
        if (!live) return;
        setState({
          status: "unknown",
          reason: "No se pudo consultar el estado del servicio de publicación.",
        });
      }
    })();
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  return state;
}