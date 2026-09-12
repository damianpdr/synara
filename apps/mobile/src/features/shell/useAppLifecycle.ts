// FILE: useAppLifecycle.ts
// Purpose: Map iOS foreground/background transitions onto the connection.
// Layer: Mobile shell feature
// Exports: useAppLifecycle, decideResumeAction, SHORT_ABSENCE_MS, PROBE_TIMEOUT_MS.
//
// The transport is AppState-agnostic; this is the only place that knows about
// the iOS lifecycle.
//
// Why not "drop the socket on background": iOS suspends the process within
// seconds, so timers stop and the socket is usually killed by the OS anyway.
// Tearing it down ourselves guarantees a full re-handshake even for a two-second
// switch to Messages, which is exactly the case where the socket most often
// survives. So the socket is left alone and the decision is made on the way
// back in:
//
//   away < 10s  -> Ping and wait up to 3s for a Pong. Alive: keep the socket
//                  (and every stream cursor with it). Silent: full reconnect.
//   away >= 10s -> reconnect without asking. The NAT mapping behind a phone's
//                  carrier/Wi-Fi is almost certainly gone, and a probe would
//                  just add 3 seconds of dead air before the same outcome.
//
// "inactive" is ignored: it fires for Control Center, the app switcher and
// incoming-call banners, none of which mean the user left.

import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

export const SHORT_ABSENCE_MS = 10_000;
export const PROBE_TIMEOUT_MS = 3_000;

export type ResumeAction = "none" | "probe" | "reconnect";

/** Pure decision so the thresholds are reviewable without an emulator. */
export function decideResumeAction(awayMs: number | null): ResumeAction {
  if (awayMs === null) return "none";
  return awayMs < SHORT_ABSENCE_MS ? "probe" : "reconnect";
}

export interface AppLifecycleHandlers {
  readonly probe: (timeoutMs: number) => Promise<boolean>;
  readonly reconnect: () => void;
}

export function useAppLifecycle({ probe, reconnect }: AppLifecycleHandlers): void {
  const backgroundedAt = useRef<number | null>(null);
  // Handlers come from a zustand store and are stable, but pinning them in a
  // ref keeps the subscription from being torn down and rebuilt if that ever
  // stops being true.
  const handlers = useRef({ probe, reconnect });
  handlers.current = { probe, reconnect };

  useEffect(() => {
    const onChange = (next: AppStateStatus): void => {
      if (next === "background") {
        backgroundedAt.current = Date.now();
        return;
      }
      if (next !== "active") return;
      const since = backgroundedAt.current;
      backgroundedAt.current = null;
      const action = decideResumeAction(since === null ? null : Date.now() - since);
      if (action === "none") return;
      if (action === "reconnect") {
        handlers.current.reconnect();
        return;
      }
      void handlers.current.probe(PROBE_TIMEOUT_MS).then((alive) => {
        if (!alive) handlers.current.reconnect();
      });
    };
    const subscription = AppState.addEventListener("change", onChange);
    return () => subscription.remove();
  }, []);
}
