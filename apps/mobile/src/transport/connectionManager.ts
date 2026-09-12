// FILE: connectionManager.ts
// Purpose: Connection lifecycle for the mobile client (auth, negotiate, socket, resubscribe).
// Layer: Mobile transport
// Exports: ConnectionManager, ConnectionStatus, ConnectionState.
//
// State machine:
//   idle -> authenticating -> negotiating -> connecting -> connected
//                                                 |            |
//                                                 +-> reconnecting -+
//   any -> paused (host app backgrounded)   any -> fatal (terminal verdict)
//
// "authenticating" covers establishing the long-lived bearer session (pairing
// exchange). "connecting" mints a *fresh* single-use ws-token on every attempt
// and opens the socket — ws tickets are 5-minute single-use and must never be
// cached across reconnects.
//
// No React, no Effect, no React Native imports: this runs under bun/node for
// scripts/smoke.ts and under Hermes in the app.

import type {
  OrchestrationShellStreamItem,
  OrchestrationThreadStreamItem,
  ThreadId,
} from "@synara/contracts";

import { SynaraCompatibilityError, SynaraHttpError, SynaraRpcError } from "./errors";
import { MOBILE_CLIENT_BUILD, RESNAPSHOT_ERROR_CODES } from "./protocolConstants";
import { RpcSocket, type StreamHandle, type WebSocketLike } from "./rpcSocket";
import { SynaraClient } from "./synaraClient";
import {
  issueWsToken,
  makeFeatureSocketUrl,
  negotiate,
  type FetchLike,
  type NegotiateResult,
} from "./synaraAuth";

export type ConnectionStatus =
  | "idle"
  | "authenticating"
  | "negotiating"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "paused"
  | "fatal";

export interface ConnectionState {
  readonly status: ConnectionStatus;
  readonly attempt: number;
  readonly serverInstanceId: string | null;
  readonly serverBuild: string | null;
  /** Protocol revision agreed during the last successful negotiate. */
  readonly protocolRevision: number | null;
  /** Protocol epoch agreed during the last successful negotiate. */
  readonly protocolEpoch: number | null;
  readonly lastError: string | null;
  /** Set only in the `fatal` state: what the user has to do about it. */
  readonly fatalAction: "update-client" | "update-server" | "re-pair" | null;
}

export interface ConnectionManagerOptions {
  readonly baseUrl: string;
  readonly sessionToken: string;
  readonly createWebSocket: (url: string) => WebSocketLike;
  readonly fetchImpl?: FetchLike | undefined;
  readonly clientBuild?: string | undefined;
  /** Injected so tests can drive backoff without real time. */
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly log?: ((message: string, detail?: unknown) => void) | undefined;
  readonly baseBackoffMs?: number | undefined;
  readonly maxBackoffMs?: number | undefined;
}

type ShellRegistration = {
  readonly onItem: (item: OrchestrationShellStreamItem) => void;
  handle: StreamHandle | null;
};

type ThreadRegistration = {
  readonly threadId: ThreadId;
  readonly onItem: (item: OrchestrationThreadStreamItem) => void;
  readonly onStreamError: ((error: SynaraRpcError) => void) | undefined;
  cursor: number | undefined;
  handle: StreamHandle | null;
};

export interface Subscription {
  close(): void;
}

const DEFAULT_BASE_BACKOFF_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class ConnectionManager {
  private readonly options: ConnectionManagerOptions;
  private readonly listeners = new Set<(state: ConnectionState) => void>();
  private readonly threads = new Map<string, ThreadRegistration>();
  private shell: ShellRegistration | null = null;

  private socket: RpcSocket | null = null;
  private client: SynaraClient | null = null;
  private running = false;
  private loopActive = false;
  private state: ConnectionState = {
    status: "idle",
    attempt: 0,
    serverInstanceId: null,
    serverBuild: null,
    protocolRevision: null,
    protocolEpoch: null,
    lastError: null,
    fatalAction: null,
  };
  /** Set while the reconnect loop is sleeping; calling it cuts the backoff short. */
  private wakeBackoff: (() => void) | null = null;

  constructor(options: ConnectionManagerOptions) {
    this.options = options;
  }

  getState(): ConnectionState {
    return this.state;
  }

  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  /** The live client, or null while disconnected. */
  getClient(): SynaraClient | null {
    return this.client;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.runLoop();
  }

  /** Terminal for this manager instance: drops the socket and all registrations. */
  stop(): void {
    this.running = false;
    this.shell = null;
    this.threads.clear();
    this.dropSocket();
    this.patch({ status: "idle", attempt: 0 });
  }

  /** AppState-agnostic: the host calls this when the app leaves the foreground. */
  pause(): void {
    if (!this.running) return;
    this.running = false;
    this.dropSocket();
    this.patch({ status: "paused" });
  }

  /** Resumes with the existing subscription registry, so cursors survive. */
  resume(): void {
    if (this.running) {
      // Already running but possibly mid-backoff: shorten the wait instead of
      // leaving the user staring at a stale screen for up to 30 seconds.
      this.wakeBackoff?.();
      return;
    }
    this.running = true;
    this.patch({ status: "reconnecting", attempt: 0 });
    void this.runLoop();
  }

  /**
   * Drops the current socket (if any) and reconnects immediately, resetting the
   * backoff. This is what the host calls when it has reason to believe the
   * socket is dead — a long background stint, a failed `probe()`, or a user
   * tapping "Retry" — and after a `fatal` verdict the user chose to retry.
   */
  reconnectNow(): void {
    this.patch({ attempt: 0, fatalAction: null });
    this.dropSocket();
    if (this.running) {
      this.patch({ status: "reconnecting" });
      this.wakeBackoff?.();
      return;
    }
    this.running = true;
    this.patch({ status: "reconnecting" });
    void this.runLoop();
  }

  /**
   * Round-trips a `Ping` on the live socket. `false` means "no Pong inside
   * `timeoutMs`", which on iOS usually means the socket survived a background
   * stint on paper but its NAT mapping did not. Never throws, never reconnects:
   * the caller decides.
   */
  probe(timeoutMs = 3_000): Promise<boolean> {
    const socket = this.socket;
    if (!socket || !socket.isOpen) return Promise.resolve(false);
    return socket.ping(timeoutMs);
  }

  subscribeShell(onItem: (item: OrchestrationShellStreamItem) => void): Subscription {
    this.shell?.handle?.close();
    const registration: ShellRegistration = { onItem, handle: null };
    this.shell = registration;
    if (this.client) this.openShellStream(registration);
    return {
      close: () => {
        if (this.shell !== registration) return;
        registration.handle?.close();
        this.shell = null;
      },
    };
  }

  /**
   * `onStreamError` is only called for a *server rejection* of the subscribe
   * (stream-capacity limit, unknown thread, permission) — the class of failure
   * the reconnect loop will never fix on its own, so the screen has to say
   * something. Transport failures and cursor invalidation are handled here and
   * are deliberately not reported.
   */
  subscribeThread(
    threadId: ThreadId,
    onItem: (item: OrchestrationThreadStreamItem) => void,
    onStreamError?: (error: SynaraRpcError) => void,
  ): Subscription {
    const existing = this.threads.get(threadId);
    existing?.handle?.close();
    const registration: ThreadRegistration = {
      threadId,
      onItem,
      onStreamError,
      // Reuse the previous cursor only if it was captured against the server
      // instance we are still talking to; instance changes clear the whole map.
      cursor: existing?.cursor,
      handle: null,
    };
    this.threads.set(threadId, registration);
    if (this.client) this.openThreadStream(registration);
    return {
      close: () => {
        if (this.threads.get(threadId) !== registration) return;
        registration.handle?.close();
        this.threads.delete(threadId);
      },
    };
  }

  // ---------------------------------------------------------------- internals

  private patch(partial: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener(this.state);
  }

  private dropSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.client = null;
    if (this.shell) this.shell.handle = null;
    for (const registration of this.threads.values()) registration.handle = null;
    socket?.close();
  }

  private backoffMs(attempt: number): number {
    const base = this.options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    const max = this.options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    const exponential = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
    // Full jitter: keeps a fleet of reconnecting phones from synchronising.
    return Math.round(exponential / 2 + Math.random() * (exponential / 2));
  }

  private async runLoop(): Promise<void> {
    if (this.loopActive) return;
    this.loopActive = true;
    const sleep = this.options.sleep ?? defaultSleep;
    try {
      while (this.running) {
        const attempt = this.state.attempt + 1;
        try {
          await this.connectOnce(attempt);
          if (!this.running) return;
          // connectOnce resolves when the socket closes.
          this.patch({ status: "reconnecting", attempt });
        } catch (error) {
          if (!this.running) return;
          if (this.isFatal(error)) {
            this.patch({
              status: "fatal",
              lastError: error instanceof Error ? error.message : String(error),
              fatalAction: this.fatalActionFor(error),
            });
            this.running = false;
            return;
          }
          this.options.log?.("connect attempt failed", error);
          this.patch({
            status: "reconnecting",
            attempt,
            lastError: error instanceof Error ? error.message : String(error),
          });
        }
        if (!this.running) return;
        await this.backoffSleep(sleep, this.backoffMs(attempt));
      }
    } finally {
      this.loopActive = false;
      this.wakeBackoff = null;
    }
  }

  /**
   * Backoff that `resume()`/`reconnectNow()` can cut short. Without this a
   * foregrounded app can sit for the remainder of a 30s sleep before it even
   * tries, which reads as a hang.
   */
  private async backoffSleep(sleep: (ms: number) => Promise<void>, ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        this.wakeBackoff = null;
        resolve();
      };
      this.wakeBackoff = settle;
      void sleep(ms).then(settle);
    });
  }

  private isFatal(error: unknown): boolean {
    if (error instanceof SynaraCompatibilityError) {
      // A server-generation change is not terminal: renegotiating is exactly
      // the fix, and the next loop iteration does that.
      return error.code !== "WS_SERVER_GENERATION_CHANGED";
    }
    // The bearer session is gone (expired/revoked): only re-pairing helps.
    return error instanceof SynaraHttpError && (error.status === 401 || error.status === 403);
  }

  private fatalActionFor(error: unknown): "update-client" | "update-server" | "re-pair" {
    if (error instanceof SynaraCompatibilityError) {
      return error.action === "update-server" ? "update-server" : "update-client";
    }
    return "re-pair";
  }

  /** Resolves when the socket that was opened by this attempt closes. */
  private async connectOnce(attempt: number): Promise<void> {
    const context = {
      baseUrl: this.options.baseUrl,
      fetchImpl: this.options.fetchImpl,
    };

    this.patch({ status: "negotiating", attempt });
    const negotiated: NegotiateResult = await negotiate({
      ...context,
      clientBuild: this.options.clientBuild ?? MOBILE_CLIENT_BUILD,
    });
    this.applyServerIdentity(negotiated);
    if (!this.running) return;

    this.patch({ status: "authenticating" });
    const ticket = await issueWsToken({ ...context, sessionToken: this.options.sessionToken });
    if (!this.running) return;

    this.patch({ status: "connecting" });
    const url = makeFeatureSocketUrl({
      baseUrl: this.options.baseUrl,
      negotiated,
      wsToken: ticket.token,
      ...(this.options.clientBuild === undefined ? {} : { clientBuild: this.options.clientBuild }),
    });

    await new Promise<void>((resolve) => {
      let settled = false;
      const socket = new RpcSocket({
        url,
        createWebSocket: this.options.createWebSocket,
        ...(this.options.log === undefined ? {} : { log: this.options.log }),
        onOpen: () => {
          // The client only exists once the socket is open. Publishing it
          // earlier would let a screen mounting during "connecting" open a
          // stream that resubscribeAll then opens a second time, leaking one
          // of the 8 per-connection thread-stream slots.
          this.client = new SynaraClient(socket);
          this.patch({ status: "connected", attempt: 0, lastError: null });
          this.resubscribeAll();
        },
        onClose: (info) => {
          if (settled) return;
          settled = true;
          if (this.socket === socket) this.dropSocket();
          this.options.log?.("socket closed", info);
          resolve();
        },
      });
      this.socket = socket;
    });
  }

  /**
   * Cursors are only comparable within the journal that issued them, so a new
   * `serverInstanceId` invalidates every `afterSequence` we hold. Mirrors
   * apps/web/src/threadDetailResumeCursors.ts::resetThreadDetailResumeCursors.
   */
  private applyServerIdentity(negotiated: NegotiateResult): void {
    if (
      this.state.serverInstanceId !== null &&
      this.state.serverInstanceId !== negotiated.serverInstanceId
    ) {
      for (const registration of this.threads.values()) registration.cursor = undefined;
    }
    this.patch({
      serverInstanceId: negotiated.serverInstanceId,
      serverBuild: negotiated.serverBuild,
      protocolRevision: negotiated.negotiatedRevision,
      protocolEpoch: negotiated.protocolEpoch,
    });
  }

  private resubscribeAll(): void {
    // `dropSocket` nulls every handle, so a non-null handle here means the
    // stream is already live on this socket and must not be opened twice.
    if (this.shell && this.shell.handle === null) this.openShellStream(this.shell);
    for (const registration of this.threads.values()) {
      if (registration.handle === null) this.openThreadStream(registration);
    }
  }

  private openShellStream(registration: ShellRegistration): void {
    const client = this.client;
    if (!client) return;
    registration.handle = client.subscribeShell({
      onItem: (item) => registration.onItem(item),
      onError: (error) => {
        registration.handle = null;
        if (this.shouldRestartStream(error)) this.openShellStream(registration);
      },
      onDone: () => {
        registration.handle = null;
      },
    });
  }

  private openThreadStream(registration: ThreadRegistration): void {
    const client = this.client;
    if (!client) return;
    registration.handle = client.subscribeThread(
      { threadId: registration.threadId, afterSequence: registration.cursor },
      {
        onItem: (item) => {
          if (item.kind === "snapshot") {
            // A snapshot replaces cached detail wholesale, so its fence is
            // authoritative even when lower than the previous cursor.
            registration.cursor = item.snapshot.snapshotSequence;
          } else if (
            registration.cursor === undefined ||
            item.event.sequence > registration.cursor
          ) {
            registration.cursor = item.event.sequence;
          }
          registration.onItem(item);
        },
        onError: (error) => {
          registration.handle = null;
          if (this.shouldRestartStream(error)) {
            // RESNAPSHOT/STALLED means the cursor is no longer serviceable; drop
            // it and restart from a full snapshot without touching the socket.
            registration.cursor = undefined;
            this.openThreadStream(registration);
            return;
          }
          // Anything else the server named is terminal for this stream: without
          // this the screen sits on "Loading thread…" with no explanation.
          if (error instanceof SynaraRpcError) registration.onStreamError?.(error);
        },
        onDone: () => {
          registration.handle = null;
        },
      },
    );
  }

  /**
   * Cursor/capacity failures must not tear the socket down — restart just that
   * stream. Transport failures are handled by the reconnect loop instead.
   */
  private shouldRestartStream(error: Error): boolean {
    if (!this.running || !this.client) return false;
    if (!(error instanceof SynaraRpcError)) return false;
    // Deliberately NOT `|| error.retryable`: a stream-capacity rejection is
    // retryable, and restarting it immediately would hammer the server with no
    // backoff. Only cursor invalidation is safe to retry in place.
    return RESNAPSHOT_ERROR_CODES.has(error.code);
  }
}
