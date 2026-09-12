// FILE: synaraStore.ts
// Purpose: Single app store: credentials, connection lifecycle, shell + thread projections.
// Layer: Mobile state
// Exports: useSynaraStore.
//
// Screens stay thin: they read slices from here and call actions. The store
// owns the one ConnectionManager instance for the process; it is deliberately
// module-level rather than context-provided so a screen remount never rebuilds
// the socket.

import { create } from "zustand";

import type { ThreadId } from "@synara/contracts";

import { ConnectionManager, type ConnectionState } from "@/transport/connectionManager";
import { bootstrapBearer, normalizeBaseUrl, parsePairingUrl } from "@/transport/synaraAuth";
import type { WebSocketLike } from "@/transport/rpcSocket";
import {
  applyShellItem,
  emptyShellProjection,
  type ShellProjection,
} from "@/state/shellProjection";
import {
  applyThreadItem,
  emptyThreadProjection,
  type ThreadProjection,
} from "@/state/threadProjection";
import { clearCredentials, loadCredentials, saveCredentials } from "@/state/credentials";

const IDLE_CONNECTION: ConnectionState = {
  status: "idle",
  attempt: 0,
  serverInstanceId: null,
  serverBuild: null,
  lastError: null,
  fatalAction: null,
};

interface SynaraStoreState {
  readonly hydrated: boolean;
  readonly baseUrl: string | null;
  readonly connection: ConnectionState;
  readonly shell: ShellProjection;
  readonly threads: Readonly<Record<string, ThreadProjection>>;
  readonly pairingError: string | null;
  readonly pairingBusy: boolean;

  hydrate(): Promise<void>;
  connectWithPairingUrl(pairingUrl: string): Promise<boolean>;
  connectWithSessionToken(baseUrl: string, sessionToken: string): Promise<boolean>;
  disconnect(): Promise<void>;
  watchThread(threadId: ThreadId): () => void;
  pause(): void;
  resume(): void;
}

let manager: ConnectionManager | null = null;
let shellSubscription: { close(): void } | null = null;
let unsubscribeState: (() => void) | null = null;

function createWebSocket(url: string): WebSocketLike {
  // React Native's WebSocket sends no Origin header, which the server's origin
  // gate allows for bearer-authenticated upgrades, and cannot negotiate
  // permessage-deflate — neither matters for this protocol.
  return new WebSocket(url) as unknown as WebSocketLike;
}

export const useSynaraStore = create<SynaraStoreState>((set, get) => {
  function teardown(): void {
    shellSubscription?.close();
    shellSubscription = null;
    unsubscribeState?.();
    unsubscribeState = null;
    manager?.stop();
    manager = null;
  }

  function startManager(baseUrl: string, sessionToken: string): void {
    teardown();
    const next = new ConnectionManager({ baseUrl, sessionToken, createWebSocket });
    manager = next;
    unsubscribeState = next.onStateChange((connection) => set({ connection }));
    next.start();
    shellSubscription = next.subscribeShell((item) => {
      set({ shell: applyShellItem(get().shell, item) });
    });
    set({ baseUrl, shell: emptyShellProjection, threads: {} });
  }

  return {
    hydrated: false,
    baseUrl: null,
    connection: IDLE_CONNECTION,
    shell: emptyShellProjection,
    threads: {},
    pairingError: null,
    pairingBusy: false,

    async hydrate() {
      if (get().hydrated) return;
      const credentials = await loadCredentials();
      set({ hydrated: true });
      if (credentials) startManager(credentials.baseUrl, credentials.sessionToken);
    },

    async connectWithPairingUrl(pairingUrl) {
      set({ pairingBusy: true, pairingError: null });
      try {
        const { baseUrl, credential } = parsePairingUrl(pairingUrl);
        const session = await bootstrapBearer({ baseUrl, credential });
        await saveCredentials({ baseUrl, sessionToken: session.sessionToken });
        startManager(baseUrl, session.sessionToken);
        return true;
      } catch (error) {
        set({ pairingError: error instanceof Error ? error.message : String(error) });
        return false;
      } finally {
        set({ pairingBusy: false });
      }
    },

    async connectWithSessionToken(rawBaseUrl, sessionToken) {
      set({ pairingBusy: true, pairingError: null });
      try {
        const baseUrl = normalizeBaseUrl(rawBaseUrl);
        await saveCredentials({ baseUrl, sessionToken: sessionToken.trim() });
        startManager(baseUrl, sessionToken.trim());
        return true;
      } catch (error) {
        set({ pairingError: error instanceof Error ? error.message : String(error) });
        return false;
      } finally {
        set({ pairingBusy: false });
      }
    },

    async disconnect() {
      teardown();
      await clearCredentials();
      set({
        baseUrl: null,
        connection: IDLE_CONNECTION,
        shell: emptyShellProjection,
        threads: {},
        pairingError: null,
      });
    },

    /**
     * Opens a thread-detail stream for as long as the screen is mounted. The
     * returned disposer interrupts the stream, which is what releases the
     * server's per-client thread-stream lease (8 max).
     */
    watchThread(threadId) {
      const active = manager;
      if (!active) return () => undefined;
      set({
        threads: { ...get().threads, [threadId]: emptyThreadProjection },
      });
      const subscription = active.subscribeThread(threadId, (item) => {
        const threads = get().threads;
        const current = threads[threadId] ?? emptyThreadProjection;
        set({ threads: { ...threads, [threadId]: applyThreadItem(current, item) } });
      });
      return () => subscription.close();
    },

    pause() {
      manager?.pause();
    },

    resume() {
      manager?.resume();
    },
  };
});

/**
 * The live ConnectionManager, or null while disconnected.
 *
 * Added by the thread-screen work (feat/mobile-thread) as the single new export
 * on this file — deliberately appended at EOF so the merge is a pure addition.
 * The thread store needs `dispatchCommand` (send / interrupt / approval
 * responses) and `getTurnDiff`, and it owns its own subscription lifecycle
 * (refcounted, with a retention window), none of which `watchThread` can
 * express. Callers must NOT cache the result: `startManager` replaces the
 * instance on re-pair, and a cached reference would dispatch into a dead socket.
 */
export function getConnectionManager(): ConnectionManager | null {
  return manager;
}
