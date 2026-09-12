// FILE: StatusPill.tsx
// Purpose: Connection status indicator shared by the list and detail screens.
// Layer: Mobile UI
// Exports: StatusPill.

import { StyleSheet, Text, View } from "react-native";

import type { ConnectionStatus } from "@/transport/connectionManager";
import { colors, spacing } from "@/ui/theme";

const LABELS: Record<ConnectionStatus, string> = {
  idle: "disconnected",
  authenticating: "authenticating",
  negotiating: "negotiating",
  connecting: "connecting",
  connected: "connected",
  reconnecting: "reconnecting",
  paused: "paused",
  fatal: "disconnected",
};

export function StatusPill({ status }: { readonly status: ConnectionStatus }) {
  const tone =
    status === "connected" ? colors.accent : status === "fatal" ? colors.danger : colors.muted;
  return (
    <View style={[styles.pill, { borderColor: tone }]}>
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Text style={[styles.label, { color: tone }]}>{LABELS[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 11, letterSpacing: 1, textTransform: "uppercase" },
});
