import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ThreadId } from "@synara/contracts";

import { ConnectionManager, type ConnectionStatus } from "./connectionManager";
import { FakeWebSocket, makeFakeFetch } from "./fakeWebSocket.testutil";

const NEGOTIATED = (serverInstanceId: string) => ({
  status: 200,
  body: {
    protocolEpoch: 1,
    negotiatedRevision: 1,
    serverBuild: "0.8.3",
    serverInstanceId,
    capabilities: [
      "orchestration.cursor-safe-streams",
      "orchestration.thread-detail-snapshot",
      "rpc.typed-errors",
    ],
  },
});

function harness(
  overrides: Partial<Parameters<typeof makeFakeFetch>[0]> & { instanceIds?: string[] } = {},
) {
  const instanceIds = overrides.instanceIds ?? ["instance-a"];
  let negotiateCount = 0;
  const { fetchImpl, calls } = makeFakeFetch({
    negotiate:
      overrides.negotiate ??
      (() => {
        const id = instanceIds[Math.min(negotiateCount, instanceIds.length - 1)] as string;
        negotiateCount += 1;
        return NEGOTIATED(id);
      }),
    ...(overrides.wsToken ? { wsToken: overrides.wsToken } : {}),
  });
  const sleeps: number[] = [];
  const states: ConnectionStatus[] = [];
  const manager = new ConnectionManager({
    baseUrl: "http://server.test:3775",
    sessionToken: "session-token",
    createWebSocket: (url) => new FakeWebSocket(url),
    fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
      // Yield to the macrotask queue rather than resolving synchronously: a
      // zero-cost sleep would let a failing connect loop starve vi.waitFor.
      await new Promise((resolve) => setTimeout(resolve, 1));
    },
    baseBackoffMs: 100,
    maxBackoffMs: 800,
  });
  manager.onStateChange((state) => states.push(state.status));
  return { manager, calls, sleeps, states };
}

const latestSocket = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

async function waitForSocket(count: number): Promise<FakeWebSocket> {
  await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(count));
  return latestSocket() as FakeWebSocket;
}

beforeEach(() => {
  FakeWebSocket.reset();
});

describe("ConnectionManager lifecycle", () => {
  it("walks idle -> negotiating -> authenticating -> connecting -> connected", async () => {
    const { manager, states } = harness();
    manager.start();
    const ws = await waitForSocket(1);
    ws.fireOpen();
    await vi.waitFor(() => expect(manager.getState().status).toBe("connected"));
    expect(states).toEqual([
      "idle",
      "negotiating",
      "negotiating",
      "authenticating",
      "connecting",
      "connected",
    ]);
    expect(manager.getState().serverInstanceId).toBe("instance-a");
    expect(manager.getClient()).not.toBeNull();
    manager.stop();
  });

  it("puts the ws-token and the negotiated identity into the socket URL", async () => {
    const { manager } = harness();
    manager.start();
    const ws = await waitForSocket(1);
    expect(ws.url).toContain("ws://server.test:3775/ws?");
    expect(ws.url).toContain("wsToken=ticket");
    expect(ws.url).toContain("x-synara-protocol-epoch=1");
    expect(ws.url).toContain("x-synara-protocol-revision=1");
    expect(ws.url).toContain("x-synara-server-instance=instance-a");
    manager.stop();
  });

  it("mints a fresh ws-token on every connect attempt", async () => {
    const { manager, calls } = harness();
    manager.start();
    (await waitForSocket(1)).fireOpen();
    await vi.waitFor(() => expect(manager.getState().status).toBe("connected"));
    latestSocket()?.drop();
    (await waitForSocket(2)).fireOpen();
    await vi.waitFor(() => expect(manager.getState().status).toBe("connected"));
    const tokenCalls = calls.filter((call) => call.url.includes("/api/auth/ws-token"));
    expect(tokenCalls).toHaveLength(2);
    expect(tokenCalls[0]?.headers["Authorization"]).toBe("Bearer session-token");
    // No Origin header: bearer mutations are rejected for untrusted origins but
    // accepted when Origin is absent, which is what React Native sends.
    expect(Object.keys(tokenCalls[0]?.headers ?? {})).not.toContain("Origin");
    manager.stop();
  });

  it("backs off with growing delays between failed attempts", async () => {
    const { manager, sleeps } = harness({ negotiate: () => ({ status: 500, body: {} }) });
    manager.start();
    await vi.waitFor(() => expect(sleeps.length).toBeGreaterThanOrEqual(3));
    manager.stop();
    // Full jitter: each delay is in [exp/2, exp], and exp doubles per attempt.
    expect(sleeps[0]).toBeGreaterThanOrEqual(50);
    expect(sleeps[0]).toBeLessThanOrEqual(100);
    expect(sleeps[1]).toBeLessThanOrEqual(200);
    expect(sleeps[2]).toBeLessThanOrEqual(400);
    expect(sleeps[2]).toBeGreaterThan(sleeps[0] as number);
  });

  it("stops permanently on a 426 compatibility verdict", async () => {
    const { manager } = harness({
      negotiate: () => ({
        status: 426,
        body: {
          _tag: "WsCompatibilityError",
          message: "client too old",
          code: "WS_PROTOCOL_INCOMPATIBLE",
          action: "update-client",
          serverBuild: "9.9.9",
        },
      }),
    });
    manager.start();
    await vi.waitFor(() => expect(manager.getState().status).toBe("fatal"));
    expect(manager.getState().fatalAction).toBe("update-client");
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("stops permanently when the bearer session is rejected", async () => {
    const { manager } = harness({ wsToken: () => ({ status: 401, body: {} }) });
    manager.start();
    await vi.waitFor(() => expect(manager.getState().status).toBe("fatal"));
    expect(manager.getState().fatalAction).toBe("re-pair");
  });

  it("pause drops the socket and resume rebuilds it", async () => {
    const { manager } = harness();
    manager.start();
    (await waitForSocket(1)).fireOpen();
    await vi.waitFor(() => expect(manager.getState().status).toBe("connected"));
    manager.pause();
    expect(manager.getState().status).toBe("paused");
    expect(manager.getClient()).toBeNull();
    manager.resume();
    (await waitForSocket(2)).fireOpen();
    await vi.waitFor(() => expect(manager.getState().status).toBe("connected"));
    manager.stop();
  });
});

describe("ConnectionManager subscriptions", () => {
  it("re-opens registered streams after a reconnect, resuming from the cursor", async () => {
    const { manager } = harness();
    const items: string[] = [];
    manager.start();
    const first = await waitForSocket(1);
    first.fireOpen();
    await vi.waitFor(() => expect(manager.getState().status).toBe("connected"));

    manager.subscribeShell(() => items.push("shell"));
    manager.subscribeThread("thread-1" as ThreadId, (item) => items.push(item.kind));

    const subscribeBefore = first
      .frames()
      .filter((frame) => frame["tag"] === "orchestration.subscribeThread");
    expect(subscribeBefore).toHaveLength(1);
    // No cursor is known yet, so the first subscribe asks for a full snapshot.
    expect(subscribeBefore[0]?.["payload"]).toEqual({ threadId: "thread-1" });

    const threadRequestId = subscribeBefore[0]?.["id"] as string;
    first.emit({
      _tag: "Chunk",
      requestId: threadRequestId,
      values: [{ kind: "snapshot", snapshot: { snapshotSequence: 12, thread: {} } }],
    });
    first.emit({
      _tag: "Chunk",
      requestId: threadRequestId,
      values: [{ kind: "event", event: { sequence: 17, type: "thread.message-sent" } }],
    });
    expect(items).toEqual(["snapshot", "event"]);

    first.drop();
    const second = await waitForSocket(2);
    second.fireOpen();
    await vi.waitFor(() => expect(manager.getState().status).toBe("connected"));

    const tags = second.frames().map((frame) => frame["tag"]);
    expect(tags).toContain("orchestration.subscribeShell");
    const resubscribe = second
      .frames()
      .find((frame) => frame["tag"] === "orchestration.subscribeThread");
    expect(resubscribe?.["payload"]).toEqual({ threadId: "thread-1", afterSequence: 17 });
    manager.stop();
  });

  it("drops thread cursors when the server instance changes", async () => {
    const { manager } = harness({ instanceIds: ["instance-a", "instance-b"] });
    manager.start();
    const first = await waitForSocket(1);
    first.fireOpen();
    await vi.waitFor(() => expect(manager.getState().status).toBe("connected"));
    manager.subscribeThread("thread-1" as ThreadId, () => undefined);
    const requestId = first
      .frames()
      .find((frame) => frame["tag"] === "orchestration.subscribeThread")?.["id"] as string;
    first.emit({
      _tag: "Chunk",
      requestId,
      values: [{ kind: "event", event: { sequence: 42 } }],
    });

    first.drop();
    const second = await waitForSocket(2);
    second.fireOpen();
    await vi.waitFor(() => expect(manager.getState().serverInstanceId).toBe("instance-b"));

    const resubscribe = second
      .frames()
      .find((frame) => frame["tag"] === "orchestration.subscribeThread");
    // Sequences are only comparable within the journal that issued them.
    expect(resubscribe?.["payload"]).toEqual({ threadId: "thread-1" });
    manager.stop();
  });

  it("restarts a stalled thread stream without a cursor and without dropping the socket", async () => {
    const { manager } = harness();
    manager.start();
    const ws = await waitForSocket(1);
    ws.fireOpen();
    await vi.waitFor(() => expect(manager.getState().status).toBe("connected"));
    manager.subscribeThread("thread-1" as ThreadId, () => undefined);
    const requestId = ws
      .frames()
      .find((frame) => frame["tag"] === "orchestration.subscribeThread")?.["id"] as string;
    ws.emit({ _tag: "Chunk", requestId, values: [{ kind: "event", event: { sequence: 9 } }] });
    ws.emit({
      _tag: "Exit",
      requestId,
      exit: {
        _tag: "Failure",
        cause: [
          {
            _tag: "Fail",
            error: {
              code: "ORCHESTRATION_RESNAPSHOT_REQUIRED",
              message: "cursor too old",
              retryable: true,
            },
          },
        ],
      },
    });
    const subscribes = ws
      .frames()
      .filter((frame) => frame["tag"] === "orchestration.subscribeThread");
    expect(subscribes).toHaveLength(2);
    expect(subscribes[1]?.["payload"]).toEqual({ threadId: "thread-1" });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(manager.getState().status).toBe("connected");
    manager.stop();
  });

  it("opens exactly one stream when a screen subscribes before the socket opens", async () => {
    const { manager } = harness();
    manager.start();
    const ws = await waitForSocket(1);
    // A screen mounted while the manager is still "connecting" subscribes here.
    // If the client were published before onOpen, this request plus the one
    // resubscribeAll issues would both be live and one thread-stream slot (of
    // the server's 8) would leak for the lifetime of the socket.
    const items: string[] = [];
    manager.subscribeThread("thread-1" as ThreadId, (item) => items.push(item.kind));
    ws.fireOpen();
    await vi.waitFor(() => expect(manager.getState().status).toBe("connected"));
    const subscribes = ws
      .frames()
      .filter((frame) => frame["tag"] === "orchestration.subscribeThread");
    expect(subscribes).toHaveLength(1);
    manager.stop();
  });

  it("interrupts the stream when a subscription handle is closed", async () => {
    const { manager } = harness();
    manager.start();
    const ws = await waitForSocket(1);
    ws.fireOpen();
    await vi.waitFor(() => expect(manager.getState().status).toBe("connected"));
    const subscription = manager.subscribeThread("thread-1" as ThreadId, () => undefined);
    subscription.close();
    expect(ws.framesOfTag("Interrupt")).toHaveLength(1);
    manager.stop();
  });
});
