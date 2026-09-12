// FILE: errors.ts
// Purpose: Error types shared by the mobile transport modules.
// Layer: Mobile transport
// Exports: SynaraHttpError, SynaraCompatibilityError, SynaraRpcError, SynaraTransportError.

/** A non-2xx answer from one of the plain-HTTP auth endpoints. */
export class SynaraHttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "SynaraHttpError";
    this.status = status;
    this.body = body;
  }
}

/**
 * A terminal protocol verdict (HTTP 426). `action` tells the UI what the user
 * has to do; retrying the same build against the same server cannot help.
 * Shape mirrors `WsCompatibilityError` in packages/contracts/src/wsCompatibility.ts.
 */
export class SynaraCompatibilityError extends Error {
  readonly code: string;
  readonly action: "reload" | "update-client" | "update-server";
  readonly serverBuild: string | undefined;
  constructor(input: {
    message: string;
    code: string;
    action: "reload" | "update-client" | "update-server";
    serverBuild?: string | undefined;
  }) {
    super(input.message);
    this.name = "SynaraCompatibilityError";
    this.code = input.code;
    this.action = input.action;
    this.serverBuild = input.serverBuild;
  }
}

/** A typed failure the server returned inside an RPC `Exit`. */
export class SynaraRpcError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly method: string;
  constructor(input: { message: string; code: string; retryable: boolean; method: string }) {
    super(input.message);
    this.name = "SynaraRpcError";
    this.code = input.code;
    this.retryable = input.retryable;
    this.method = input.method;
  }
}

/** The socket died, timed out, or was closed while a request was in flight. */
export class SynaraTransportError extends Error {
  readonly code: "SOCKET_CLOSED" | "REQUEST_TIMEOUT" | "SOCKET_DEFECT" | "PROTOCOL_ERROR";
  constructor(
    message: string,
    code: "SOCKET_CLOSED" | "REQUEST_TIMEOUT" | "SOCKET_DEFECT" | "PROTOCOL_ERROR",
  ) {
    super(message);
    this.name = "SynaraTransportError";
    this.code = code;
  }
}
