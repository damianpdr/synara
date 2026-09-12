import { describe, expect, it } from "vitest";

import {
  decodeFailure,
  decodeServerFrame,
  encodeAck,
  encodeInterrupt,
  encodePing,
  encodeRequest,
  serializeFrame,
} from "./rpcFrames";

describe("client frame encoding", () => {
  it("encodes a Request with the exact field set the server expects", () => {
    const frame = encodeRequest({ id: "7", tag: "orchestration.getShellSnapshot", payload: {} });
    expect(frame._tag).toBe("Request");
    expect(frame.id).toBe("7");
    expect(frame.tag).toBe("orchestration.getShellSnapshot");
    expect(frame.payload).toEqual({});
    expect(frame.headers).toEqual([]);
    expect(frame.sampled).toBe(false);
    expect(frame.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(frame.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(Object.keys(JSON.parse(serializeFrame(frame)) as object).toSorted()).toEqual([
      "_tag",
      "headers",
      "id",
      "payload",
      "sampled",
      "spanId",
      "tag",
      "traceId",
    ]);
  });

  it("encodes Ack, Interrupt and Ping", () => {
    expect(JSON.parse(serializeFrame(encodeAck("3")))).toEqual({ _tag: "Ack", requestId: "3" });
    expect(JSON.parse(serializeFrame(encodeInterrupt("3")))).toEqual({
      _tag: "Interrupt",
      requestId: "3",
    });
    expect(JSON.parse(serializeFrame(encodePing()))).toEqual({ _tag: "Ping" });
  });
});

describe("decodeServerFrame", () => {
  it("decodes a Chunk", () => {
    expect(
      decodeServerFrame('{"_tag":"Chunk","requestId":"1","values":[{"kind":"snapshot"}]}'),
    ).toEqual({ _tag: "Chunk", requestId: "1", values: [{ kind: "snapshot" }] });
  });

  it("decodes a successful Exit", () => {
    const frame = decodeServerFrame(
      '{"_tag":"Exit","requestId":"2","exit":{"_tag":"Success","value":42}}',
    );
    expect(frame).toEqual({
      _tag: "Exit",
      requestId: "2",
      exit: { _tag: "Success", value: 42 },
    });
  });

  it("decodes Pong, Defect and ClientProtocolError", () => {
    expect(decodeServerFrame('{"_tag":"Pong"}')).toEqual({ _tag: "Pong" });
    expect(decodeServerFrame('{"_tag":"Defect","defect":"boom"}')).toEqual({
      _tag: "Defect",
      defect: "boom",
    });
    expect(decodeServerFrame('{"_tag":"ClientProtocolError","error":{"x":1}}')).toEqual({
      _tag: "ClientProtocolError",
      error: { x: 1 },
    });
  });

  it("returns null for malformed input and unknown tags instead of throwing", () => {
    expect(decodeServerFrame("not json")).toBeNull();
    expect(decodeServerFrame("null")).toBeNull();
    expect(decodeServerFrame('{"_tag":"SomethingNew","x":1}')).toBeNull();
    expect(decodeServerFrame('{"_tag":"Chunk","requestId":1,"values":[]}')).toBeNull();
    expect(decodeServerFrame('{"_tag":"Chunk","requestId":"1"}')).toBeNull();
  });
});

describe("decodeFailure", () => {
  it("extracts a typed WsRpcError from a Fail cause", () => {
    expect(
      decodeFailure({
        _tag: "Failure",
        cause: [
          {
            _tag: "Fail",
            error: {
              _tag: "WsRpcError",
              code: "ORCHESTRATION_RESNAPSHOT_REQUIRED",
              message: "cursor too old",
              retryable: true,
            },
          },
        ],
      }),
    ).toMatchObject({
      kind: "fail",
      code: "ORCHESTRATION_RESNAPSHOT_REQUIRED",
      message: "cursor too old",
      retryable: true,
    });
  });

  it("reports a Die cause as a non-retryable server defect", () => {
    expect(
      decodeFailure({ _tag: "Failure", cause: [{ _tag: "Die", defect: { message: "kaboom" } }] }),
    ).toMatchObject({ kind: "die", code: "SERVER_DEFECT", retryable: false });
  });

  it("reports an interrupt-only cause as retryable", () => {
    expect(
      decodeFailure({ _tag: "Failure", cause: [{ _tag: "Interrupt", fiberId: 3 }] }),
    ).toMatchObject({ kind: "interrupt", retryable: true });
  });
});
