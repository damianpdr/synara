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
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
  type AppearancePreference,
  type Preferences,
} from "@/state/preferences";
import { buildThreadCreateCommand, pickThreadDefaults } from "@/features/shell/createThread";
import { diagnosePairingError } from "@/features/connections/pairingErrors";
import { newId } from "@/transport/ids";
import type { SynaraClient } from "@/transport/synaraClient";

const IDLE_CONNECTION: ConnectionState = {
  status: "idle",
  attempt: 0,
  serverInstanceId: null,
  serverBuild: null,
  protocolRevision: null,
  protocolEpoch: null,
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

  // --- shell additions (SHELL agent) ------------------------------------
  // Everything below is additive; nothing above changed shape.

  /** Role reported by the server during pairing ("owner", ...), when known. */
  readonly role: string | null;
  /** ISO timestamp of the moment the socket last reached `connected`. */
  readonly connectedSince: string | null;
  /** True while a pull-to-refresh snapshot fetch is in flight. */
  readonly refreshing: boolean;
  /** True while a `thread.create` dispatch is in flight. */
  readonly creatingThread: boolean;
  readonly createThreadError: string | null;
  /** Actionable follow-up for `pairingError`, when one exists. */
  readonly pairingHint: string | null;
  readonly appearance: AppearancePreference;
  readonly showArchived: boolean;
  readonly collapsedProjectIds: readonly string[];

  /** The live client, or null while disconnected. Shared with the thread feature. */
  getClient(): SynaraClient | null;
  /** Re-fetches the shell snapshot over the open socket (pull-to-refresh). */
  refreshShell(): Promise<void>;
  /** Ping/Pong liveness check on the current socket. Never throws. */
  probeConnection(timeoutMs?: number): Promise<boolean>;
  /** Drops the socket and reconnects immediately, resetting backoff. */
  reconnectNow(): void;
  /**
   * Creates a thread in `projectId` and resolves its id, or null on failure
   * (the reason lands in `createThreadError`).
   */
  createThread(projectId: string, title?: string): Promise<string | null>;
  setAppearance(appearance: AppearancePreference): void;
  setShowArchived(showArchived: boolean): void;
  toggleProjectCollapsed(projectId: string): void;
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
    unsubscribeState = next.onStateChange((connection) => {
      // `connectedSince` marks the current unbroken session, so it is stamped
      // on the transition into `connected` and cleared on the way out; a
      // reconnect restarts the clock, which is what the settings card means.
      const previous = get();
      const connectedSince =
        connection.status === "connected"
          ? previous.connection.status === "connected"
            ? previous.connectedSince
            : new Date().toISOString()
          : null;
      set({ connection, connectedSince });
    });
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
      const [credentials, preferences] = await Promise.all([loadCredentials(), loadPreferences()]);
      set({
        hydrated: true,
        appearance: preferences.appearance,
        showArchived: preferences.showArchived,
        collapsedProjectIds: preferences.collapsedProjectIds,
        role: credentials?.role ?? null,
      });
      if (credentials) startManager(credentials.baseUrl, credentials.sessionToken);
    },

    async connectWithPairingUrl(pairingUrl) {
      set({ pairingBusy: true, pairingError: null, pairingHint: null });
      try {
        const { baseUrl, credential } = parsePairingUrl(pairingUrl);
        const session = await bootstrapBearer({ baseUrl, credential });
        await saveCredentials({
          baseUrl,
          sessionToken: session.sessionToken,
          role: session.role,
        });
        set({ role: session.role });
        startManager(baseUrl, session.sessionToken);
        return true;
      } catch (error) {
        const diagnosis = diagnosePairingError(error, safeOrigin(pairingUrl));
        set({ pairingError: diagnosis.message, pairingHint: diagnosis.hint });
        return false;
      } finally {
        set({ pairingBusy: false });
      }
    },

    async connectWithSessionToken(rawBaseUrl, sessionToken) {
      set({ pairingBusy: true, pairingError: null, pairingHint: null });
      try {
        const baseUrl = normalizeBaseUrl(rawBaseUrl);
        // A raw session token carries no role claim the client can trust; only
        // the pairing exchange reports one.
        set({ role: null });
        await saveCredentials({ baseUrl, sessionToken: sessionToken.trim() });
        startManager(baseUrl, sessionToken.trim());
        return true;
      } catch (error) {
        const diagnosis = diagnosePairingError(error, rawBaseUrl);
        set({ pairingError: diagnosis.message, pairingHint: diagnosis.hint });
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
        pairingHint: null,
        role: null,
        connectedSince: null,
        createThreadError: null,
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

    // --- shell additions (SHELL agent) ------------------------------------

    role: null,
    connectedSince: null,
    refreshing: false,
    creatingThread: false,
    createThreadError: null,
    pairingHint: null,
    appearance: DEFAULT_PREFERENCES.appearance,
    showArchived: DEFAULT_PREFERENCES.showArchived,
    collapsedProjectIds: DEFAULT_PREFERENCES.collapsedProjectIds,

    getClient() {
      return manager?.getClient() ?? null;
    },

    async refreshShell() {
      const client = manager?.getClient();
      if (!client) return;
      set({ refreshing: true });
      try {
        const snapshot = await client.getShellSnapshot();
        // A snapshot that raced a live event must not rewind the list: the
        // stream keeps flowing during the fetch, so an older sequence is
        // strictly worse than what is already on screen.
        if (snapshot.snapshotSequence >= get().shell.snapshotSequence) {
          set({ shell: applyShellItem(get().shell, { kind: "snapshot", snapshot }) });
        }
      } catch {
        // The reconnect loop owns transport failures; a failed manual refresh
        // just leaves the last good list up.
      } finally {
        set({ refreshing: false });
      }
    },

    probeConnection(timeoutMs) {
      return manager?.probe(timeoutMs) ?? Promise.resolve(false);
    },

    reconnectNow() {
      manager?.reconnectNow();
    },

    async createThread(projectId, title) {
      const client = manager?.getClient();
      if (!client) {
        set({ createThreadError: "Not connected to a Synara server." });
        return null;
      }
      const shell = get().shell;
      set({ creatingThread: true, createThreadError: null });
      try {
        const threadId = newId("thread");
        await client.dispatchCommand(
          buildThreadCreateCommand({
            commandId: newId("cmd"),
            threadId,
            projectId,
            ...(title === undefined ? {} : { title }),
            defaults: pickThreadDefaults({
              projectId,
              threads: shell.threads,
              projects: shell.projects,
            }),
            createdAt: new Date().toISOString(),
          }),
        );
        return threadId;
      } catch (error) {
        set({ createThreadError: error instanceof Error ? error.message : String(error) });
        return null;
      } finally {
        set({ creatingThread: false });
      }
    },

    setAppearance(appearance) {
      set({ appearance });
      void savePreferences(snapshotPreferences(get()));
    },

    setShowArchived(showArchived) {
      set({ showArchived });
      void savePreferences(snapshotPreferences(get()));
    },

    toggleProjectCollapsed(projectId) {
      const current = get().collapsedProjectIds;
      const collapsedProjectIds = current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId];
      set({ collapsedProjectIds });
      void savePreferences(snapshotPreferences(get()));
    },
  };
});

/** Best-effort origin for an error message; never throws on malformed input. */
function safeOrigin(candidate: string): string | null {
  try {
    return new URL(candidate.trim()).origin;
  } catch {
    return null;
  }
}

function snapshotPreferences(state: SynaraStoreState): Preferences {
  return {
    appearance: state.appearance,
    showArchived: state.showArchived,
    collapsedProjectIds: state.collapsedProjectIds,
  };
}
