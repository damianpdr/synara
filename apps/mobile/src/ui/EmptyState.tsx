// FILE: EmptyState.tsx
// Purpose: Centered icon + explanation + optional action for an empty surface.
// Layer: Mobile UI
// Exports: EmptyState.

import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/ThemeProvider";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

export interface EmptyStateProps {
  readonly icon?: IoniconName;
  readonly title: string;
  readonly message?: string;
  readonly actionLabel?: string;
  readonly onAction?: (() => void) | undefined;
}

export function EmptyState({ icon, title, message, actionLabel, onAction }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View style={[styles.root, { padding: theme.spacing.xl, gap: theme.spacing.sm }]}>
      {icon ? (
        <View
          style={[
            styles.glyph,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: theme.radii.xl,
              marginBottom: theme.spacing.sm,
            },
          ]}
        >
          <Ionicons name={icon} size={26} color={theme.colors.textTertiary} />
        </View>
      ) : null}
      <Text variant="headline" style={styles.centered}>
        {title}
      </Text>
      {message ? (
        <Text variant="subhead" color="secondary" style={styles.centered}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          variant="tinted"
          onPress={onAction}
          style={{ marginTop: theme.spacing.md }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", justifyContent: "center" },
  glyph: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  centered: { textAlign: "center" },
});
