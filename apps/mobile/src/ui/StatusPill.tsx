// FILE: StatusPill.tsx
// Purpose: Connection status indicator shared by the list and detail screens.
// Layer: Mobile UI
// Exports: StatusPill, connectionStatusLabel, connectionStatusTone.

import { Pill, type PillTone } from "@/ui/Pill";
import type { ConnectionStatus } from "@/transport/connectionManager";

const LABELS: Record<ConnectionStatus, string> = {
  idle: "Offline",
  authenticating: "Authenticating",
  negotiating: "Connecting",
  connecting: "Connecting",
  connected: "Live",
  reconnecting: "Reconnecting",
  paused: "Paused",
  fatal: "Disconnected",
};

const TONES: Record<ConnectionStatus, PillTone> = {
  idle: "neutral",
  authenticating: "warning",
  negotiating: "warning",
  connecting: "warning",
  connected: "success",
  reconnecting: "warning",
  paused: "neutral",
  fatal: "danger",
};

export function connectionStatusLabel(status: ConnectionStatus): string {
  return LABELS[status];
}

export function connectionStatusTone(status: ConnectionStatus): PillTone {
  return TONES[status];
}

export function StatusPill({ status }: { readonly status: ConnectionStatus }) {
  return <Pill label={LABELS[status]} tone={TONES[status]} dot />;
}
