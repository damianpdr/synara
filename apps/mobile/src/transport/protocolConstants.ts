// FILE: protocolConstants.ts
// Purpose: Runtime copies of the Synara WebSocket protocol constants.
// Layer: Mobile transport
// Exports: Paths, query parameter names, protocol revisions, capability list.
//
// These values are duplicated on purpose. `@synara/contracts` is a type-only
// dependency of `@synara/mobile`: its modules import `effect`, and pulling the
// Effect runtime into a React Native bundle would cost hundreds of kilobytes
// for values that are three strings and two integers. Every constant below is
// copied verbatim from `packages/contracts/src/wsCompatibility.ts`; if that
// file changes, change this one too (the values are part of the wire protocol,
// so they change rarely and loudly).

/** Source: packages/contracts/src/wsCompatibility.ts */
export const WS_PROTOCOL_EPOCH = 1;
export const WS_PROTOCOL_MIN_REVISION = 1;
export const WS_PROTOCOL_MAX_REVISION = 1;

/** Source: packages/contracts/src/wsCompatibility.ts */
export const WS_NEGOTIATE_HTTP_PATH = "/ws/negotiate";
export const WS_FEATURE_PATH = "/ws";

/** Source: apps/server/src/auth/Layers/ServerAuth.ts (WEBSOCKET_TOKEN_QUERY_PARAM) */
export const WS_TOKEN_QUERY_PARAM = "wsToken";

/** Source: apps/server/src/http.ts (`/api/auth/*` route table) */
export const AUTH_BOOTSTRAP_BEARER_PATH = "/api/auth/bootstrap/bearer";
export const AUTH_WS_TOKEN_PATH = "/api/auth/ws-token";
export const AUTH_PAIRING_TOKEN_PATH = "/api/auth/pairing-token";
export const AUTH_SESSION_PATH = "/api/auth/session";

/** Source: apps/web/src/pairingBootstrap.ts */
export const PAIRING_PATH = "/pair";

/** Source: packages/contracts/src/wsCompatibility.ts (WS_COMPATIBILITY_QUERY) */
export const WS_COMPATIBILITY_QUERY = {
  clientBuild: "x-synara-client-build",
  protocolEpoch: "x-synara-protocol-epoch",
  protocolRevision: "x-synara-protocol-revision",
  serverInstanceId: "x-synara-server-instance",
} as const;

/** Source: packages/contracts/src/wsCompatibility.ts (WS_NEGOTIATE_QUERY) */
export const WS_NEGOTIATE_QUERY = {
  clientBuild: "x-synara-client-build",
  protocolEpoch: "x-synara-protocol-epoch",
  minRevision: "x-synara-protocol-min-revision",
  maxRevision: "x-synara-protocol-max-revision",
  requiredCapability: "x-synara-required-capability",
} as const;

/**
 * Deliberately a strict subset of the web client's
 * `WS_CLIENT_REQUIRED_CAPABILITIES`: a shipped mobile binary cannot be
 * hot-fixed, so it must only refuse to run without capabilities it genuinely
 * cannot work around. The web list additionally demands
 * `git.worktree-setup-progress`, which this app never calls.
 */
export const MOBILE_REQUIRED_CAPABILITIES = [
  "orchestration.cursor-safe-streams",
  "orchestration.thread-detail-snapshot",
  "rpc.typed-errors",
] as const;

/** Source: packages/contracts/src/orchestration.ts (ORCHESTRATION_WS_METHODS) */
export const ORCHESTRATION_METHODS = {
  getShellSnapshot: "orchestration.getShellSnapshot",
  getThreadDetailSnapshot: "orchestration.getThreadDetailSnapshot",
  dispatchCommand: "orchestration.dispatchCommand",
  replayEvents: "orchestration.replayEvents",
  getTurnDiff: "orchestration.getTurnDiff",
  subscribeShell: "orchestration.subscribeShell",
  unsubscribeShell: "orchestration.unsubscribeShell",
  subscribeThread: "orchestration.subscribeThread",
  unsubscribeThread: "orchestration.unsubscribeThread",
} as const;

/** Source: packages/contracts/src/wsCompatibility.ts (WS_STREAM_LIMITS) */
export const WS_STREAM_LIMITS = { totalPerClient: 20, threadPerClient: 8 } as const;

/**
 * Server errors that invalidate a stream's cursor without invalidating the
 * socket. Source: apps/server/src/wsRpc.ts.
 */
export const RESNAPSHOT_ERROR_CODES = new Set([
  "ORCHESTRATION_RESNAPSHOT_REQUIRED",
  "ORCHESTRATION_SNAPSHOT_STALLED",
]);

/** Advertised to the server as `x-synara-client-build`. Matches package.json. */
export const MOBILE_CLIENT_BUILD = "0.8.3-mobile";
