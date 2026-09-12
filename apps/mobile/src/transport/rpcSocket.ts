// FILE: rpcSocket.ts
// Purpose: Request/stream multiplexer over one Synara Effect-RPC WebSocket.
// Layer: Mobile transport
// Exports: RpcSocket, WebSocketLike, StreamHandle.
//
// Platform-agnostic on purpose: the only host APIs it touches are a WebSocket
// constructor (injectable) and setTimeout/setInterval. No React, no Effect.

/* eslint-disable unicorn/prefer-add-event-listener -- The `onopen`/`onmessage`/
   `onclose`/`onerror` properties are the only handler API React Native's
   WebSocket and `ws` implement identically; `addEventListener` differs in event
   shape between hosts. */

import { SynaraRpcError, SynaraTransportError } from "./errors";
import {
  decodeFailure,
  decodeServerFrame,
  encodeAck,
  encodeInterrupt,
  encodePing,
  encodeRequest,
  serializeFrame,
  type ServerFrame,
} from "./rpcFrames";

/**
 * The subset of the WebSocket API that both React Native and `ws`/bun implement
 * with identical semantics. Handler *properties* are used rather than
 * addEventListener because RN's implementation supports both but only the
 * properties are guaranteed to behave the same across hosts.
 */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface StreamHandlers<T> {
  readonly onItem: (item: T) => void;
  /** Terminal: the stream failed. The socket itself may still be healthy. */
  readonly onError?: (error: Error) => void;
  /** Terminal: the server ended the stream normally. */
  readonly onDone?: () => void;
}

export interface StreamHandle {
  readonly requestId: string;
  /** Sends `Interrupt`, which is what actually releases the server's stream lease. */
  close(): void;
}

export interface RpcSocketOptions {
  readonly url: string;
  readonly createWebSocket: (url: string) => WebSocketLike;
  /** Fires once the socket is open and usable. */
  readonly onOpen?: () => void;
  /** Fires exactly once when the socket is gone; the RpcSocket is dead after this. */
  readonly onClose?: (info: { code?: number | undefined; reason?: string | undefined }) => void;
  readonly pingIntervalMs?: number;
  readonly requestTimeoutMs?: number;
  readonly log?: (message: string, detail?: unknown) => void;
}

const DEFAULT_PING_INTERVAL_MS = 20_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

type Pending =
  | {
      readonly kind: "unary";
      readonly method: string;
      readonly resolve: (value: unknown) => void;
      readonly reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout> | undefined;
    }
  | {
      readonly kind: "stream";
      readonly method: string;
      readonly handlers: StreamHandlers<never>;
    };

export class RpcSocket {
  private readonly options: RpcSocketOptions;
  private readonly socket: WebSocketLike;
  private readonly pending = new Map<string, Pending>();
  private nextId = 1;
  private open = false;
  private closed = false;
  private queue: string[] = [];
  private pingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: RpcSocketOptions) {
    this.options = options;
    this.socket = options.createWebSocket(options.url);
    this.socket.onopen = () => {
      this.open = true;
      for (const frame of this.queue) this.socket.send(frame);
      this.queue = [];
      this.pingTimer = setInterval(
        () => this.write(serializeFrame(encodePing())),
        options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS,
      );
      options.onOpen?.();
    };
    this.socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      const frame = decodeServerFrame(event.data);
      if (frame) this.handleFrame(frame);
    };
    this.socket.onerror = (event) => {
      this.options.log?.("rpcSocket error", event);
    };
    this.socket.onclose = (event) => {
      this.teardown(
        new SynaraTransportError(
          `WebSocket closed (code ${String(event?.code ?? "unknown")}).`,
          "SOCKET_CLOSED",
        ),
        { code: event?.code, reason: event?.reason },
      );
    };
  }

  get isOpen(): boolean {
    return this.open && !this.closed;
  }

  /** Unary RPC. Rejects with SynaraRpcError (server verdict) or SynaraTransportError. */
  request<T>(method: string, payload: unknown = {}, timeoutMs?: number): Promise<T> {
    if (this.closed) {
      return Promise.reject(new SynaraTransportError("Socket is closed.", "SOCKET_CLOSED"));
    }
    const id = this.allocateId();
    return new Promise<T>((resolve, reject) => {
      const effectiveTimeout =
        timeoutMs ?? this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      const entry: Pending = {
        kind: "unary",
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer: undefined,
      };
      if (effectiveTimeout > 0) {
        entry.timer = setTimeout(() => {
          if (!this.pending.delete(id)) return;
          // A timed-out request may still be running server-side; interrupt it
          // so the server does not keep producing for a listener that is gone.
          this.write(serializeFrame(encodeInterrupt(id)));
          reject(
            new SynaraTransportError(
              `${method} timed out after ${effectiveTimeout}ms.`,
              "REQUEST_TIMEOUT",
            ),
          );
        }, effectiveTimeout);
      }
      this.pending.set(id, entry);
      this.write(serializeFrame(encodeRequest({ id, tag: method, payload })));
    });
  }

  /** Streaming RPC. Items arrive via `handlers.onItem`; every Chunk is Acked. */
  stream<T>(method: string, payload: unknown, handlers: StreamHandlers<T>): StreamHandle {
    const id = this.allocateId();
    if (this.closed) {
      handlers.onError?.(new SynaraTransportError("Socket is closed.", "SOCKET_CLOSED"));
      return { requestId: id, close: () => undefined };
    }
    this.pending.set(id, {
      kind: "stream",
      method,
      handlers: handlers as unknown as StreamHandlers<never>,
    });
    this.write(serializeFrame(encodeRequest({ id, tag: method, payload })));
    return {
      requestId: id,
      close: () => {
        // Drop the local listener first so late Chunks are Acked-and-discarded
        // rather than delivered, then release the server-side lease.
        this.pending.delete(id);
        this.write(serializeFrame(encodeInterrupt(id)));
      },
    };
  }

  /** Clean shutdown: interrupt every live stream, then close the socket. */
  close(code = 1000, reason = "client closed"): void {
    if (this.closed) return;
    for (const [id, entry] of this.pending) {
      if (entry.kind === "stream") this.write(serializeFrame(encodeInterrupt(id)));
    }
    try {
      this.socket.close(code, reason);
    } catch {
      // Some hosts throw when closing a socket that never opened; the onclose
      // handler (or the teardown below) still runs the cleanup.
    }
    this.teardown(new SynaraTransportError("Socket closed by client.", "SOCKET_CLOSED"), {
      code,
      reason,
    });
  }

  private allocateId(): string {
    const id = String(this.nextId);
    this.nextId += 1;
    return id;
  }

  private write(frame: string): void {
    if (this.closed) return;
    if (!this.open) {
      this.queue.push(frame);
      return;
    }
    try {
      this.socket.send(frame);
    } catch (error) {
      this.options.log?.("rpcSocket send failed", error);
    }
  }

  private handleFrame(frame: ServerFrame): void {
    switch (frame._tag) {
      case "Chunk": {
        const entry = this.pending.get(frame.requestId);
        if (entry?.kind === "stream") {
          for (const value of frame.values) {
            try {
              (entry.handlers.onItem as (item: unknown) => void)(value);
            } catch (error) {
              this.options.log?.("stream listener threw", error);
            }
          }
        }
        // CRITICAL, and unconditional: the server closes a latch before every
        // Chunk and awaits it afterwards (effect RpcServer.streamEffect). A
        // missing Ack wedges that request's fiber forever — including for
        // requests we have already dropped locally, whose trailing Exit would
        // otherwise never arrive. Acking an unknown id is a documented no-op
        // server-side (`client.latches.get(id)` -> undefined -> Effect.void).
        this.write(serializeFrame(encodeAck(frame.requestId)));
        return;
      }
      case "Exit": {
        const entry = this.pending.get(frame.requestId);
        this.pending.delete(frame.requestId);
        if (!entry) return;
        if (frame.exit._tag === "Success") {
          if (entry.kind === "unary") {
            if (entry.timer !== undefined) clearTimeout(entry.timer);
            entry.resolve(frame.exit.value);
          } else {
            entry.handlers.onDone?.();
          }
          return;
        }
        const failure = decodeFailure(frame.exit);
        const error = new SynaraRpcError({
          message: failure.message,
          code: failure.code,
          retryable: failure.retryable,
          method: entry.method,
        });
        if (entry.kind === "unary") {
          if (entry.timer !== undefined) clearTimeout(entry.timer);
          entry.reject(error);
        } else {
          entry.handlers.onError?.(error);
        }
        return;
      }
      case "Pong":
        return;
      case "Defect":
      case "ClientProtocolError": {
        // Neither frame carries a requestId, so no individual promise can be
        // settled from it; a protocol-level fault leaves the connection in an
        // unknown state. Fail everything and let the connection manager
        // rebuild the socket from scratch.
        this.options.log?.(`rpcSocket ${frame._tag}`, frame);
        this.close(1011, frame._tag);
        return;
      }
    }
  }

  private teardown(
    error: SynaraTransportError,
    info: { code?: number | undefined; reason?: string | undefined },
  ): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    if (this.pingTimer !== undefined) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
    const entries = [...this.pending.entries()];
    this.pending.clear();
    for (const [, entry] of entries) {
      if (entry.kind === "unary") {
        if (entry.timer !== undefined) clearTimeout(entry.timer);
        entry.reject(error);
      } else {
        entry.handlers.onError?.(error);
      }
    }
    this.options.onClose?.(info);
  }
}
