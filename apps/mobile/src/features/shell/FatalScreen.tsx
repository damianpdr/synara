// FILE: FatalScreen.tsx
// Purpose: Full-screen block for a terminal protocol verdict (HTTP 426).
// Layer: Mobile shell feature
// Exports: FatalScreen.
//
// `/ws/negotiate` answering 426 means this build and that server cannot talk at
// all: no screen in the app can show anything truthful, so this covers all of
// them rather than appearing as a banner one screen at a time.

import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import type { ConnectionState } from "@/transport/connectionManager";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/ThemeProvider";

export function FatalScreen({
  connection,
  onRetry,
  onDisconnect,
}: {
  readonly connection: ConnectionState;
  readonly onRetry: () => void;
  readonly onDisconnect: () => void;
}) {
  const theme = useTheme();
  const updateServer = connection.fatalAction === "update-server";
  return (
    <View
      style={[
        styles.root,
        { backgroundColor: theme.colors.canvas, padding: theme.spacing.xl, gap: theme.spacing.lg },
      ]}
    >
      <Ionicons name="git-compare-outline" size={40} color={theme.colors.warning} />
      <Text variant="title" style={styles.centered}>
        {updateServer ? "The server is out of date" : "This app is out of date"}
      </Text>
      <Text variant="callout" color="secondary" style={styles.centered}>
        {updateServer
          ? "Your Synara server speaks an older version of the protocol than this app. Update the server, then try again."
          : "Your Synara server speaks a newer version of the protocol than this app. Update the app from Expo Go (pull the latest bundle), then try again."}
      </Text>

      <Card padded style={{ gap: theme.spacing.xs, width: "100%" }}>
        <Detail label="Server build" value={connection.serverBuild ?? "unknown"} />
        <Detail
          label="Protocol"
          value={
            connection.protocolEpoch === null
              ? "not negotiated"
              : `epoch ${String(connection.protocolEpoch)}, revision ${String(connection.protocolRevision ?? "?")}`
          }
        />
        {connection.lastError ? <Detail label="Detail" value={connection.lastError} /> : null}
      </Card>

      <View style={{ gap: theme.spacing.sm, width: "100%" }}>
        <Button label="Try again" onPress={onRetry} />
        <Button label="Disconnect" variant="plain" tone="danger" onPress={onDisconnect} />
      </View>
    </View>
  );
}

function Detail({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.detail}>
      <Text variant="caption" color="tertiary" uppercase>
        {label}
      </Text>
      <Text variant="footnote" color="secondary" mono selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center" },
  centered: { textAlign: "center" },
  detail: { gap: 2, paddingVertical: 2 },
});
