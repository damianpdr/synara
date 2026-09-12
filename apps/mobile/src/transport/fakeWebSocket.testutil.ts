// FILE: fakeWebSocket.testutil.ts
// Purpose: In-memory WebSocket double for transport unit tests.
// Layer: Mobile transport (test support)
// Exports: FakeWebSocket, makeFakeFetch.
//
// Not a `.test.ts` file on purpose: vitest only collects `src/**/*.test.ts`,
// and nothing in `app/` imports this, so it never reaches the device bundle.

import type { WebSocketLike } from "./rpcSocket";

export class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  readonly url: string;
  readonly sent: string[] = [];
  closed = false;

  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    if (this.closed) throw new Error("send on closed socket");
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.({
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    });
  }

  // -- test drivers --------------------------------------------------------

  fireOpen(): void {
    this.onopen?.({});
  }

  /** Delivers one server frame as a text message. */
  emit(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  /** Simulates an abrupt network drop (no clean close handshake). */
  drop(code = 1006): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.({ code });
  }

  frames(): Record<string, unknown>[] {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }

  framesOfTag(tag: string): Record<string, unknown>[] {
    return this.frames().filter((frame) => frame["_tag"] === tag);
  }
}

export interface FakeFetchCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

/**
 * Minimal `fetch` double for the two plain-HTTP endpoints the connection
 * manager uses: `/ws/negotiate` and `/api/auth/ws-token`.
 */
export function makeFakeFetch(options: {
  negotiate: () => { status: number; body: unknown };
  wsToken?: () => { status: number; body: unknown };
}): { fetchImpl: typeof globalThis.fetch; calls: FakeFetchCall[] } {
  const calls: FakeFetchCall[] = [];
  const fetchImpl = (async (input: unknown, init?: Record<string, unknown>) => {
    const url = String(input);
    calls.push({
      url,
      method: String(init?.["method"] ?? "GET"),
      headers: (init?.["headers"] ?? {}) as Record<string, string>,
      body: init?.["body"] as string | undefined,
    });
    const result = url.includes("/ws/negotiate")
      ? options.negotiate()
      : (
          options.wsToken ??
          (() => ({ status: 200, body: { token: "ticket", expiresAt: "2099-01-01T00:00:00Z" } }))
        )();
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      text: async () => JSON.stringify(result.body),
    };
  }) as unknown as typeof globalThis.fetch;
  return { fetchImpl, calls };
}
