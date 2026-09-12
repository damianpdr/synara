import { beforeEach, describe, expect, it, vi } from "vitest";

import { SynaraRpcError, SynaraTransportError } from "./errors";
import { FakeWebSocket } from "./fakeWebSocket.testutil";
import { RpcSocket } from "./rpcSocket";

function makeSocket(): { socket: RpcSocket; ws: FakeWebSocket } {
  let ws: FakeWebSocket | undefined;
  const socket = new RpcSocket({
    url: "ws://example.test/ws",
    createWebSocket: (url) => {
      ws = new FakeWebSocket(url);
      return ws;
    },
    pingIntervalMs: 1_000_000,
  });
  return { socket, ws: ws as FakeWebSocket };
}

beforeEach(() => {
  FakeWebSocket.reset();
});

describe("RpcSocket unary requests", () => {
  it("queues frames until the socket opens, then flushes them", () => {
    const { socket, ws } = makeSocket();
    void socket.request("orchestration.getShellSnapshot");
    expect(ws.sent).toHaveLength(0);
    ws.fireOpen();
    expect(ws.framesOfTag("Request")).toHaveLength(1);
  });

  it("resolves on a Success exit and uses monotonic string ids", async () => {
    const { socket, ws } = makeSocket();
    ws.fireOpen();
    const first = socket.request<number>("a");
    const second = socket.request<number>("b");
    expect(ws.framesOfTag("Request").map((frame) => frame["id"])).toEqual(["1", "2"]);
    ws.emit({ _tag: "Exit", requestId: "2", exit: { _tag: "Success", value: 20 } });
    ws.emit({ _tag: "Exit", requestId: "1", exit: { _tag: "Success", value: 10 } });
    await expect(first).resolves.toBe(10);
    await expect(second).resolves.toBe(20);
  });

  it("rejects with a typed SynaraRpcError on a Failure exit", async () => {
    const { socket, ws } = makeSocket();
    ws.fireOpen();
    const pending = socket.request("orchestration.dispatchCommand");
    ws.emit({
      _tag: "Exit",
      requestId: "1",
      exit: {
        _tag: "Failure",
        cause: [
          {
            _tag: "Fail",
            error: { _tag: "WsRpcError", code: "BAD_INPUT", message: "nope", retryable: false },
          },
        ],
      },
    });
    await expect(pending).rejects.toBeInstanceOf(SynaraRpcError);
    await expect(pending).rejects.toMatchObject({ code: "BAD_INPUT", retryable: false });
  });

  it("times out and interrupts the request server-side", async () => {
    vi.useFakeTimers();
    try {
      const { socket, ws } = makeSocket();
      ws.fireOpen();
      const pending = socket.request("slow", {}, 50);
      vi.advanceTimersByTime(60);
      await expect(pending).rejects.toBeInstanceOf(SynaraTransportError);
      expect(ws.framesOfTag("Interrupt")).toEqual([{ _tag: "Interrupt", requestId: "1" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails every in-flight request when the socket drops", async () => {
    const { socket, ws } = makeSocket();
    ws.fireOpen();
    const pending = socket.request("a");
    ws.drop();
    await expect(pending).rejects.toMatchObject({ code: "SOCKET_CLOSED" });
    expect(socket.isOpen).toBe(false);
  });
});

describe("RpcSocket streams", () => {
  it("acks every chunk and delivers every value", () => {
    const { socket, ws } = makeSocket();
    ws.fireOpen();
    const items: unknown[] = [];
    socket.stream("orchestration.subscribeShell", {}, { onItem: (item) => items.push(item) });
    ws.emit({ _tag: "Chunk", requestId: "1", values: [{ kind: "snapshot" }] });
    ws.emit({ _tag: "Chunk", requestId: "1", values: [{ kind: "a" }, { kind: "b" }] });
    expect(items).toEqual([{ kind: "snapshot" }, { kind: "a" }, { kind: "b" }]);
    // One Ack per Chunk *frame*, not per value: the server opens one latch per
    // request and awaits it once after each frame it writes.
    expect(ws.framesOfTag("Ack")).toEqual([
      { _tag: "Ack", requestId: "1" },
      { _tag: "Ack", requestId: "1" },
    ]);
  });

  it("acks chunks for requests it has already dropped locally", () => {
    const { socket, ws } = makeSocket();
    ws.fireOpen();
    const handle = socket.stream("orchestration.subscribeShell", {}, { onItem: () => undefined });
    handle.close();
    ws.emit({ _tag: "Chunk", requestId: "1", values: [{ kind: "late" }] });
    // Skipping this Ack would wedge the server fiber and its trailing Exit.
    expect(ws.framesOfTag("Ack")).toEqual([{ _tag: "Ack", requestId: "1" }]);
  });

  it("releases the server lease with an Interrupt when closed", () => {
    const { socket, ws } = makeSocket();
    ws.fireOpen();
    const handle = socket.stream(
      "orchestration.subscribeThread",
      { threadId: "t" },
      {
        onItem: () => undefined,
      },
    );
    handle.close();
    expect(ws.framesOfTag("Interrupt")).toEqual([{ _tag: "Interrupt", requestId: "1" }]);
  });

  it("routes a Failure exit to onError and a Success exit to onDone", () => {
    const { socket, ws } = makeSocket();
    ws.fireOpen();
    const errors: Error[] = [];
    let done = false;
    socket.stream("s1", {}, { onItem: () => undefined, onError: (error) => errors.push(error) });
    socket.stream("s2", {}, { onItem: () => undefined, onDone: () => (done = true) });
    ws.emit({
      _tag: "Exit",
      requestId: "1",
      exit: {
        _tag: "Failure",
        cause: [
          {
            _tag: "Fail",
            error: { code: "ORCHESTRATION_RESNAPSHOT_REQUIRED", message: "stale", retryable: true },
          },
        ],
      },
    });
    ws.emit({ _tag: "Exit", requestId: "2", exit: { _tag: "Success", value: null } });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "ORCHESTRATION_RESNAPSHOT_REQUIRED" });
    expect(done).toBe(true);
  });

  it("interrupts live streams and closes on a protocol-level Defect", () => {
    const { socket, ws } = makeSocket();
    ws.fireOpen();
    const errors: Error[] = [];
    socket.stream("s1", {}, { onItem: () => undefined, onError: (error) => errors.push(error) });
    ws.emit({ _tag: "Defect", defect: "server exploded" });
    expect(socket.isOpen).toBe(false);
    expect(errors[0]).toBeInstanceOf(SynaraTransportError);
  });

  it("sends Interrupt for every live stream on a clean close", () => {
    const { socket, ws } = makeSocket();
    ws.fireOpen();
    socket.stream("s1", {}, { onItem: () => undefined });
    socket.stream("s2", {}, { onItem: () => undefined });
    socket.close();
    expect(ws.framesOfTag("Interrupt").map((frame) => frame["requestId"])).toEqual(["1", "2"]);
  });

  it("replies Pong-able Pings on the keepalive interval", () => {
    vi.useFakeTimers();
    try {
      let ws: FakeWebSocket | undefined;
      const socket = new RpcSocket({
        url: "ws://example.test/ws",
        createWebSocket: (url) => (ws = new FakeWebSocket(url)),
        pingIntervalMs: 100,
      });
      ws?.fireOpen();
      vi.advanceTimersByTime(250);
      expect(ws?.framesOfTag("Ping").length).toBeGreaterThanOrEqual(2);
      ws?.emit({ _tag: "Pong" });
      expect(socket.isOpen).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("RpcSocket.ping", () => {
  it("resolves true when a Pong arrives", async () => {
    const { socket, ws } = makeSocket();
    ws.fireOpen();
    const pending = socket.ping(1_000);
    expect(ws.framesOfTag("Ping")).toHaveLength(1);
    ws.emit({ _tag: "Pong" });
    await expect(pending).resolves.toBe(true);
  });

  it("resolves false when no Pong arrives inside the timeout", async () => {
    vi.useFakeTimers();
    try {
      const { socket, ws } = makeSocket();
      ws.fireOpen();
      const pending = socket.ping(3_000);
      vi.advanceTimersByTime(3_001);
      await expect(pending).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves false immediately on a socket that is not open", async () => {
    const { socket } = makeSocket();
    await expect(socket.ping(1_000)).resolves.toBe(false);
  });

  it("resolves false when the socket dies while probing", async () => {
    const { socket, ws } = makeSocket();
    ws.fireOpen();
    const pending = socket.ping(10_000);
    ws.drop();
    await expect(pending).resolves.toBe(false);
  });
});
