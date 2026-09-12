// FILE: pairingErrors.ts
// Purpose: Turn a pairing failure into something a human can act on.
// Layer: Mobile connections feature
// Exports: PairingDiagnosis, diagnosePairingError.
//
// The transport throws precise errors (SynaraHttpError with a status,
// SynaraCompatibilityError with a verdict) but the raw messages are written for
// a log, not a phone screen. Everything here is pure string work so it can be
// unit-tested without a server.

export interface PairingDiagnosis {
  readonly message: string;
  readonly hint: string | null;
}

interface Httpish {
  readonly status?: unknown;
}

function statusOf(error: unknown): number | null {
  const status = (error as Httpish | null)?.status;
  return typeof status === "number" ? status : null;
}

function textOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Expo Go's own Info.plist allows arbitrary loads, so plaintext HTTP works
 * there — but a dev build without `NSAllowsArbitraryLoads` fails with exactly
 * this string, and it is completely opaque unless you know what it means.
 */
const ATS_HINT =
  "iOS blocked a plaintext HTTP connection (App Transport Security). Expo Go normally allows it; a standalone build needs NSAllowsArbitraryLoads, or use an https:// address.";

export function diagnosePairingError(error: unknown, baseUrl?: string | null): PairingDiagnosis {
  const raw = textOf(error);
  const status = statusOf(error);
  const host = baseUrl ? ` (${baseUrl})` : "";

  if (/App Transport Security|cleartext|NSAllowsArbitraryLoads/i.test(raw)) {
    return { message: "iOS refused the connection.", hint: ATS_HINT };
  }

  if (/pairing link/i.test(raw) || /#token=/i.test(raw)) {
    return {
      message: raw,
      hint: "A pairing link looks like http://host:3775/pair#token=… — copy the whole line, including the part after the #.",
    };
  }

  if (/Invalid URL|Failed to construct/i.test(raw)) {
    return {
      message: "That does not look like a URL.",
      hint: "Include the host and port, for example 100.109.152.38:3775.",
    };
  }

  if (status === 401 || status === 403) {
    return {
      message: "The server rejected this pairing credential.",
      hint: "Pairing links are single-use and expire after about five minutes. Generate a fresh one and try again.",
    };
  }

  if (status === 404) {
    return {
      message: `No Synara server answered at that address${host}.`,
      hint: "Check the port — the dev server listens on 3775, and 3774 is a debugging proxy.",
    };
  }

  if (status !== null && status >= 500) {
    return {
      message: `The server returned an error (HTTP ${String(status)}).`,
      hint: "Check the server log; the phone did reach it.",
    };
  }

  if (/Network request failed|timed out|aborted|ECONNREFUSED|Unable to connect/i.test(raw)) {
    return {
      message: `Could not reach the server${host}.`,
      hint: "Make sure the phone is on the same network (or tailnet) as the server and that the address and port are right.",
    };
  }

  if (/update-client|update-server|incompatible|protocol/i.test(raw)) {
    return {
      message: "This app and that server speak different protocol versions.",
      hint: raw,
    };
  }

  return { message: raw, hint: null };
}
