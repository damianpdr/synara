// FILE: ConnectionBanner.tsx
// Purpose: Translate the connection state machine into one line the user can act on.
// Layer: Mobile shell feature
// Exports: ConnectionBanner, describeConnection.

import { Banner, type BannerTone } from "@/ui/Banner";
import type { ConnectionState } from "@/transport/connectionManager";

export interface ConnectionDescription {
  readonly tone: BannerTone;
  readonly message: string;
  readonly detail: string | null;
  readonly busy: boolean;
  readonly actionLabel: string | null;
}

/**
 * Returns null when there is nothing worth saying. `connected` is the normal
 * case and must be silent; a permanently visible "connected" strip is just a
 * row of pixels the list could have used.
 */
export function describeConnection(
  connection: ConnectionState,
  hasCredentials: boolean,
): ConnectionDescription | null {
  if (!hasCredentials) return null;
  switch (connection.status) {
    case "connected":
      return null;
    case "negotiating":
    case "authenticating":
    case "connecting":
      return {
        tone: "info",
        message: connection.attempt > 1 ? "Reconnecting…" : "Connecting…",
        detail: null,
        busy: true,
        actionLabel: null,
      };
    case "reconnecting":
      return {
        tone: "warning",
        message: `Reconnecting… (attempt ${String(connection.attempt)})`,
        detail: connection.lastError,
        busy: true,
        actionLabel: "Retry now",
      };
    case "paused":
      return {
        tone: "info",
        message: "Paused",
        detail: "Synara reconnects when you come back.",
        busy: false,
        actionLabel: "Reconnect",
      };
    case "fatal":
      return connection.fatalAction === "re-pair"
        ? {
            tone: "danger",
            message: "Session expired",
            detail: "This device needs to be paired with the server again.",
            busy: false,
            actionLabel: "Re-pair",
          }
        : {
            // The update verdicts get a full-screen treatment in the root
            // layout; this is only reached if that overlay is suppressed.
            tone: "danger",
            message: "Incompatible server",
            detail: connection.lastError,
            busy: false,
            actionLabel: "Retry",
          };
    case "idle":
      return {
        tone: "warning",
        message: "Offline",
        detail: connection.lastError,
        busy: false,
        actionLabel: "Connect",
      };
  }
}

export function ConnectionBanner({
  connection,
  hasCredentials,
  onRetry,
  onRepair,
}: {
  readonly connection: ConnectionState;
  readonly hasCredentials: boolean;
  readonly onRetry: () => void;
  readonly onRepair: () => void;
}) {
  const description = describeConnection(connection, hasCredentials);
  if (!description) return null;
  const isRepair = connection.status === "fatal" && connection.fatalAction === "re-pair";
  return (
    <Banner
      tone={description.tone}
      message={description.message}
      detail={description.detail}
      busy={description.busy}
      {...(description.actionLabel === null
        ? {}
        : { actionLabel: description.actionLabel, onAction: isRepair ? onRepair : onRetry })}
    />
  );
}
