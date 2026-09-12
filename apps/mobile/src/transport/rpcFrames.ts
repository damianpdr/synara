// FILE: rpcFrames.ts
// Purpose: Pure codec for the Effect-RPC-over-WebSocket wire format (JSON serialization).
// Layer: Mobile transport
// Exports: Client frame encoders, decodeServerFrame, failure extraction helpers.
//
// One JSON object per WebSocket text message. Field names are taken verbatim
// from the pinned Effect build: node_modules/effect/src/unstable/rpc/RpcMessage.ts
// (`RequestEncoded`, `AckEncoded`, `InterruptEncoded`, `Ping`, `ResponseChunkEncoded`,
// `ResponseExitEncoded`, `ResponseDefectEncoded`, `Pong`, `ClientProtocolError`).
// The server is mounted with RpcSerialization.layerJson (apps/server/src/wsRpc.ts).

export interface RequestFrame {
  readonly _tag: "Request";
  readonly id: string;
  readonly tag: string;
  readonly payload: unknown;
  readonly headers: readonly (readonly [string, string])[];
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled: boolean;
}

export interface AckFrame {
  readonly _tag: "Ack";
  readonly requestId: string;
}
export interface InterruptFrame {
  readonly _tag: "Interrupt";
  readonly requestId: string;
}
export interface PingFrame {
  readonly _tag: "Ping";
}
export interface EofFrame {
  readonly _tag: "Eof";
}

export type ClientFrame = RequestFrame | AckFrame | InterruptFrame | PingFrame | EofFrame;

export type ExitEncoded =
  | { readonly _tag: "Success"; readonly value: unknown }
  | { readonly _tag: "Failure"; readonly cause: readonly CauseEntry[] };

export type CauseEntry =
  | { readonly _tag: "Fail"; readonly error: unknown }
  | { readonly _tag: "Die"; readonly defect: unknown }
  | { readonly _tag: "Interrupt"; readonly fiberId?: number };

export type ServerFrame =
  | { readonly _tag: "Chunk"; readonly requestId: string; readonly values: readonly unknown[] }
  | { readonly _tag: "Exit"; readonly requestId: string; readonly exit: ExitEncoded }
  | { readonly _tag: "Defect"; readonly defect: unknown }
  | { readonly _tag: "Pong" }
  | { readonly _tag: "ClientProtocolError"; readonly error: unknown };

/**
 * Hex ids for the tracing fields. Hermes has no `crypto` global, so this is
 * deliberately `Math.random`-based: these values are only trace correlation
 * hints, never security material.
 */
function randomHex(length: number): string {
  let out = "";
  while (out.length < length) out += Math.random().toString(16).slice(2);
  return out.slice(0, length);
}

export function makeTraceIds(): { traceId: string; spanId: string } {
  return { traceId: randomHex(32), spanId: randomHex(16) };
}

export function encodeRequest(input: {
  id: string;
  tag: string;
  payload: unknown;
  traceId?: string;
  spanId?: string;
}): RequestFrame {
  const ids = makeTraceIds();
  return {
    _tag: "Request",
    id: input.id,
    tag: input.tag,
    payload: input.payload,
    // The server's admission middleware reads the *upgrade* request, not
    // per-request RPC headers, so an empty list is correct.
    headers: [],
    traceId: input.traceId ?? ids.traceId,
    spanId: input.spanId ?? ids.spanId,
    sampled: false,
  };
}

export const encodeAck = (requestId: string): AckFrame => ({ _tag: "Ack", requestId });
export const encodeInterrupt = (requestId: string): InterruptFrame => ({
  _tag: "Interrupt",
  requestId,
});
export const encodePing = (): PingFrame => ({ _tag: "Ping" });
export const encodeEof = (): EofFrame => ({ _tag: "Eof" });

export function serializeFrame(frame: ClientFrame): string {
  return JSON.stringify(frame);
}

/**
 * Decodes one server text message. Returns null for anything that is not a
 * frame shape we understand, so an unknown future tag is ignored instead of
 * tearing the socket down.
 */
export function decodeServerFrame(raw: string): ServerFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const frame = parsed as Record<string, unknown>;
  switch (frame["_tag"]) {
    case "Chunk": {
      if (typeof frame["requestId"] !== "string" || !Array.isArray(frame["values"])) return null;
      return { _tag: "Chunk", requestId: frame["requestId"], values: frame["values"] };
    }
    case "Exit": {
      if (typeof frame["requestId"] !== "string" || typeof frame["exit"] !== "object") return null;
      return {
        _tag: "Exit",
        requestId: frame["requestId"],
        exit: frame["exit"] as ExitEncoded,
      };
    }
    case "Defect":
      return { _tag: "Defect", defect: frame["defect"] };
    case "Pong":
      return { _tag: "Pong" };
    case "ClientProtocolError":
      return { _tag: "ClientProtocolError", error: frame["error"] };
    default:
      return null;
  }
}

export interface DecodedFailure {
  readonly kind: "fail" | "die" | "interrupt";
  readonly message: string;
  readonly code: string;
  readonly retryable: boolean;
  readonly error: unknown;
}

/**
 * Flattens an `Exit.Failure` cause array into something a UI can act on. Typed
 * server failures are `WsRpcError` values ({ _tag, code, message, retryable });
 * see packages/contracts/src/rpc.ts.
 */
export function decodeFailure(exit: ExitEncoded): DecodedFailure {
  if (exit._tag === "Success") {
    return {
      kind: "fail",
      message: "Success exit decoded as a failure.",
      code: "UNKNOWN",
      retryable: false,
      error: undefined,
    };
  }
  for (const entry of exit.cause) {
    if (entry._tag === "Fail") {
      const error = entry.error as Record<string, unknown> | null;
      return {
        kind: "fail",
        message: typeof error?.["message"] === "string" ? error["message"] : "Request failed.",
        code: typeof error?.["code"] === "string" ? error["code"] : "UNKNOWN",
        retryable: error?.["retryable"] === true,
        error: entry.error,
      };
    }
    if (entry._tag === "Die") {
      return {
        kind: "die",
        message: `Server defect: ${stringifyDefect(entry.defect)}`,
        code: "SERVER_DEFECT",
        retryable: false,
        error: entry.defect,
      };
    }
  }
  return {
    kind: "interrupt",
    message: "Request was interrupted.",
    code: "INTERRUPTED",
    retryable: true,
    error: undefined,
  };
}

function stringifyDefect(defect: unknown): string {
  if (typeof defect === "string") return defect;
  const message = (defect as { message?: unknown } | null)?.message;
  if (typeof message === "string") return message;
  try {
    return JSON.stringify(defect);
  } catch {
    return String(defect);
  }
}
