// FILE: synaraAuth.ts
// Purpose: Plain-HTTP half of the Synara handshake (pairing, session, ws-token, negotiate).
// Layer: Mobile transport
// Exports: parsePairingUrl, bootstrapBearer, issueWsToken, negotiate, makeFeatureSocketUrl.
//
// Deliberately free of React, Effect and React Native: it uses only `fetch` and
// `URL`, so it runs unchanged under bun/node (scripts/smoke.ts) and Hermes
// (Expo installs WinterCG `URL`/`URLSearchParams`/`fetch` polyfills).
// Reference implementation: apps/web/src/wsTransport.ts + apps/web/src/wsNativeApi.ts.

import { SynaraCompatibilityError, SynaraHttpError } from "./errors";
import {
  AUTH_BOOTSTRAP_BEARER_PATH,
  AUTH_PAIRING_TOKEN_PATH,
  AUTH_WS_TOKEN_PATH,
  MOBILE_CLIENT_BUILD,
  MOBILE_REQUIRED_CAPABILITIES,
  PAIRING_PATH,
  WS_COMPATIBILITY_QUERY,
  WS_FEATURE_PATH,
  WS_NEGOTIATE_HTTP_PATH,
  WS_NEGOTIATE_QUERY,
  WS_PROTOCOL_EPOCH,
  WS_PROTOCOL_MAX_REVISION,
  WS_PROTOCOL_MIN_REVISION,
  WS_TOKEN_QUERY_PARAM,
} from "./protocolConstants";

export type FetchLike = typeof globalThis.fetch;

export interface NegotiateResult {
  readonly protocolEpoch: number;
  readonly negotiatedRevision: number;
  readonly serverBuild: string;
  readonly serverInstanceId: string;
  readonly capabilities: readonly string[];
}

export interface BearerSession {
  readonly sessionToken: string;
  readonly role: string;
  readonly expiresAt: string;
}

export interface WsTicket {
  readonly token: string;
  readonly expiresAt: string;
}

interface RequestContext {
  readonly baseUrl: string;
  readonly fetchImpl?: FetchLike | undefined;
  readonly signal?: AbortSignal | undefined;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** Normalises `http://host:port/whatever` down to a bare origin. */
export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withScheme);
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  return url.origin;
}

/**
 * Splits a one-time pairing link (`http://host:port/pair#token=<credential>`)
 * into the server origin and the credential. Mirrors the browser flow in
 * apps/web/src/pairingBootstrap.ts, which reads the credential out of the URL
 * *fragment* so it never reaches the server as a query parameter.
 */
export function parsePairingUrl(pairingUrl: string): { baseUrl: string; credential: string } {
  const url = new URL(pairingUrl.trim());
  if (url.pathname !== PAIRING_PATH) {
    throw new Error(`Not a Synara pairing link (expected path ${PAIRING_PATH}).`);
  }
  const credential = new URLSearchParams(url.hash.replace(/^#/, "")).get("token");
  if (!credential) throw new Error("Pairing link is missing its #token=... fragment.");
  return { baseUrl: url.origin, credential };
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  // AbortSignal.timeout/any exist in bun/node and are installed by Expo's
  // WinterCG runtime patch (expo/src/winter/AbortSignal.ts), but fall back
  // rather than crash if a host lacks them.
  const timeout =
    typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined;
  if (!timeout) return signal ?? new AbortController().signal;
  if (!signal) return timeout;
  return typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeout]) : signal;
}

async function requestJson<T>(
  context: RequestContext,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; sessionToken?: string | undefined },
): Promise<T> {
  const doFetch = context.fetchImpl ?? globalThis.fetch;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.sessionToken) headers["Authorization"] = `Bearer ${init.sessionToken}`;
  const response = await doFetch(`${context.baseUrl}${path}`, {
    method: init.method,
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: withTimeout(context.signal, DEFAULT_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new SynaraHttpError(
      `${init.method} ${path} failed with HTTP ${response.status}.`,
      response.status,
      text,
    );
  }
  return JSON.parse(text) as T;
}

/**
 * Exchanges a one-time pairing credential for a 30-day bearer session token.
 * Source route: apps/server/src/http.ts `/api/auth/bootstrap/bearer`.
 */
export async function bootstrapBearer(
  input: RequestContext & { credential: string },
): Promise<BearerSession> {
  const result = await requestJson<{
    authenticated: true;
    role: string;
    sessionMethod: string;
    expiresAt: string;
    sessionToken: string;
  }>(input, AUTH_BOOTSTRAP_BEARER_PATH, {
    method: "POST",
    body: { credential: input.credential },
  });
  return {
    sessionToken: result.sessionToken,
    role: result.role,
    expiresAt: result.expiresAt,
  };
}

/**
 * Mints a single-use, 5-minute WebSocket ticket. Must be re-issued for every
 * connect attempt — never cached across reconnects.
 */
export async function issueWsToken(
  input: RequestContext & { sessionToken: string },
): Promise<WsTicket> {
  return requestJson<WsTicket>(input, AUTH_WS_TOKEN_PATH, {
    method: "POST",
    sessionToken: input.sessionToken,
  });
}

/** Owner-only: mints a fresh pairing link so a second device can be paired. */
export async function issuePairingCredential(
  input: RequestContext & { sessionToken: string; label?: string },
): Promise<{ id: string; credential: string; expiresAt: string }> {
  return requestJson(input, AUTH_PAIRING_TOKEN_PATH, {
    method: "POST",
    sessionToken: input.sessionToken,
    body: input.label === undefined ? {} : { label: input.label },
  });
}

export function makeNegotiateUrl(baseUrl: string, clientBuild = MOBILE_CLIENT_BUILD): string {
  const url = new URL(`${baseUrl}${WS_NEGOTIATE_HTTP_PATH}`);
  url.searchParams.set(WS_NEGOTIATE_QUERY.clientBuild, clientBuild);
  url.searchParams.set(WS_NEGOTIATE_QUERY.protocolEpoch, String(WS_PROTOCOL_EPOCH));
  url.searchParams.set(WS_NEGOTIATE_QUERY.minRevision, String(WS_PROTOCOL_MIN_REVISION));
  url.searchParams.set(WS_NEGOTIATE_QUERY.maxRevision, String(WS_PROTOCOL_MAX_REVISION));
  for (const capability of MOBILE_REQUIRED_CAPABILITIES) {
    url.searchParams.append(WS_NEGOTIATE_QUERY.requiredCapability, capability);
  }
  return url.toString();
}

/**
 * Negotiates protocol compatibility over plain HTTP so a connect costs exactly
 * one WebSocket upgrade. A 426 is terminal and surfaces as
 * SynaraCompatibilityError; everything else is a transient failure the caller
 * may retry.
 *
 * React Native's WebSocket cannot read an upgrade response body, so the mobile
 * client always negotiates here rather than trying to parse a 426 off a failed
 * upgrade (the browser transport has the same blind spot).
 */
export async function negotiate(
  input: RequestContext & { clientBuild?: string },
): Promise<NegotiateResult> {
  const doFetch = input.fetchImpl ?? globalThis.fetch;
  const response = await doFetch(makeNegotiateUrl(input.baseUrl, input.clientBuild), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: withTimeout(input.signal, DEFAULT_TIMEOUT_MS),
  });
  const text = await response.text();
  if (response.status === 426) {
    const body = JSON.parse(text) as {
      message?: string;
      code?: string;
      action?: "reload" | "update-client" | "update-server";
      serverBuild?: string;
    };
    throw new SynaraCompatibilityError({
      message: body.message ?? "Server rejected this client build.",
      code: body.code ?? "WS_PROTOCOL_INCOMPATIBLE",
      action: body.action ?? "update-client",
      serverBuild: body.serverBuild,
    });
  }
  if (!response.ok) {
    throw new SynaraHttpError(
      `GET ${WS_NEGOTIATE_HTTP_PATH} failed with HTTP ${response.status}.`,
      response.status,
      text,
    );
  }
  return JSON.parse(text) as NegotiateResult;
}

/**
 * Builds the feature-socket URL. The ws ticket rides as a query parameter
 * because React Native cannot set headers on a WebSocket upgrade; the server
 * reads it from `?wsToken=` (apps/server/src/auth/Layers/ServerAuth.ts).
 * No Origin header is sent by RN, which the server's origin gate allows for
 * bearer-authenticated upgrades.
 */
export function makeFeatureSocketUrl(input: {
  baseUrl: string;
  negotiated: NegotiateResult;
  wsToken: string;
  clientBuild?: string;
}): string {
  const url = new URL(`${input.baseUrl}${WS_FEATURE_PATH}`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set(
    WS_COMPATIBILITY_QUERY.clientBuild,
    input.clientBuild ?? MOBILE_CLIENT_BUILD,
  );
  url.searchParams.set(
    WS_COMPATIBILITY_QUERY.protocolEpoch,
    String(input.negotiated.protocolEpoch),
  );
  url.searchParams.set(
    WS_COMPATIBILITY_QUERY.protocolRevision,
    String(input.negotiated.negotiatedRevision),
  );
  url.searchParams.set(WS_COMPATIBILITY_QUERY.serverInstanceId, input.negotiated.serverInstanceId);
  url.searchParams.set(WS_TOKEN_QUERY_PARAM, input.wsToken);
  return url.toString();
}
