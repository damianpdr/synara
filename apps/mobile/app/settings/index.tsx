// FILE: index.tsx
// Purpose: Settings modal — connection, list behaviour, appearance, about.
// Layer: Mobile screens

import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useCallback } from "react";
import { Alert, ScrollView, StyleSheet, Switch, View } from "react-native";

import { formatAbsoluteDateTime } from "@/features/shell/relativeTime";
import { useSynaraStore } from "@/state/synaraStore";
import type { AppearancePreference } from "@/state/preferences";
import { Button } from "@/ui/Button";
import { Card, CardDivider } from "@/ui/Card";
import { haptic } from "@/ui/haptics";
import { Pill } from "@/ui/Pill";
import { PressableRow } from "@/ui/PressableRow";
import { Screen } from "@/ui/Screen";
import { SectionHeader } from "@/ui/SectionHeader";
import { connectionStatusLabel, connectionStatusTone } from "@/ui/StatusPill";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/ThemeProvider";

const APPEARANCE_OPTIONS: readonly {
  readonly key: AppearancePreference;
  readonly label: string;
}[] = [
  { key: "system", label: "System" },
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
];

export default function SettingsScreen() {
  const theme = useTheme();
  const baseUrl = useSynaraStore((state) => state.baseUrl);
  const connection = useSynaraStore((state) => state.connection);
  const connectedSince = useSynaraStore((state) => state.connectedSince);
  const role = useSynaraStore((state) => state.role);
  const appearance = useSynaraStore((state) => state.appearance);
  const showArchived = useSynaraStore((state) => state.showArchived);
  const setAppearance = useSynaraStore((state) => state.setAppearance);
  const setShowArchived = useSynaraStore((state) => state.setShowArchived);
  const disconnect = useSynaraStore((state) => state.disconnect);

  const confirmDisconnect = useCallback(() => {
    haptic("warning");
    Alert.alert(
      "Disconnect from Synara?",
      "The saved session token is deleted from this device's keychain. You will need a new pairing link to reconnect.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => {
            void disconnect().then(() => {
              // Back to the root, which now renders the pairing view.
              router.dismissAll();
            });
          },
        },
      ],
    );
  }, [disconnect]);

  const appVersion =
    Constants.expoConfig?.version ?? Constants.expoConfig?.runtimeVersion ?? "unknown";

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.xxl,
        }}
      >
        <SectionHeader title="Connection" />
        <Card>
          <View style={[styles.block, { padding: theme.spacing.lg, gap: theme.spacing.md }]}>
            <View style={[styles.headline, { gap: theme.spacing.sm }]}>
              <Text variant="headline" numberOfLines={1} style={styles.grow}>
                {baseUrl ?? "Not paired"}
              </Text>
              <Pill
                label={connectionStatusLabel(connection.status)}
                tone={connectionStatusTone(connection.status)}
                dot
              />
            </View>
            <Field label="Server build" value={connection.serverBuild ?? "—"} />
            <Field label="Server instance" value={shortId(connection.serverInstanceId)} />
            <Field label="Role" value={role ?? "—"} />
            <Field
              label="Connected since"
              value={connectedSince === null ? "—" : formatAbsoluteDateTime(connectedSince)}
            />
            {connection.lastError ? (
              <Field label="Last error" value={connection.lastError} tone="danger" />
            ) : null}
          </View>
          <CardDivider />
          <View style={[styles.block, { padding: theme.spacing.md, gap: theme.spacing.sm }]}>
            <Button
              label="Re-pair this device"
              variant="tinted"
              icon="qr-code-outline"
              onPress={() => router.push("/connect")}
            />
            <Button
              label="Disconnect"
              variant="plain"
              tone="danger"
              onPress={confirmDisconnect}
              disabled={baseUrl === null}
            />
          </View>
        </Card>

        <SectionHeader title="Threads" />
        <Card>
          <View
            style={[
              styles.switchRow,
              { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md },
            ]}
          >
            <View style={styles.grow}>
              <Text variant="body">Show archived threads</Text>
              <Text variant="footnote" color="tertiary">
                Archived threads are hidden from the list by default.
              </Text>
            </View>
            <Switch
              value={showArchived}
              onValueChange={(next) => {
                haptic("selection");
                setShowArchived(next);
              }}
              trackColor={{ true: theme.colors.accent, false: theme.colors.surfaceSunken }}
            />
          </View>
        </Card>

        <SectionHeader title="Appearance" />
        <Card>
          {APPEARANCE_OPTIONS.map((option, index) => (
            <View key={option.key}>
              {index === 0 ? null : <CardDivider inset={theme.spacing.lg} />}
              <ChoiceRow
                label={option.label}
                selected={appearance === option.key}
                onPress={() => setAppearance(option.key)}
              />
            </View>
          ))}
        </Card>

        <SectionHeader title="About" />
        <Card>
          <View style={[styles.block, { padding: theme.spacing.lg, gap: theme.spacing.md }]}>
            <Field label="App version" value={String(appVersion)} />
            <Field
              label="Protocol"
              value={
                connection.protocolEpoch === null
                  ? "not negotiated"
                  : `epoch ${String(connection.protocolEpoch)}, revision ${String(
                      connection.protocolRevision ?? "?",
                    )}`
              }
            />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

function ChoiceRow({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableRow chevron={false} onPress={onPress} accessibilityLabel={label}>
      <View style={styles.choice}>
        <Text variant="body" style={styles.grow}>
          {label}
        </Text>
        {selected ? <Ionicons name="checkmark" size={18} color={theme.colors.accent} /> : null}
      </View>
    </PressableRow>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: "danger";
}) {
  return (
    <View style={styles.field}>
      <Text variant="caption" color="tertiary" uppercase>
        {label}
      </Text>
      <Text variant="footnote" color={tone === "danger" ? "danger" : "secondary"} mono selectable>
        {value}
      </Text>
    </View>
  );
}

/** Instance ids are UUIDs; the first block is enough to tell restarts apart. */
function shortId(value: string | null): string {
  if (!value) return "—";
  return value.length <= 12 ? value : `${value.slice(0, 8)}…`;
}

const styles = StyleSheet.create({
  block: {},
  headline: { flexDirection: "row", alignItems: "center" },
  grow: { flex: 1 },
  field: { gap: 2 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  choice: { flexDirection: "row", alignItems: "center" },
});
