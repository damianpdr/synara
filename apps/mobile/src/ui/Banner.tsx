// FILE: Banner.tsx
// Purpose: Inline status strip with an optional action (retry, dismiss).
// Layer: Mobile UI
// Exports: Banner, BannerTone.

import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { haptic } from "@/ui/haptics";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/ThemeProvider";

export type BannerTone = "info" | "warning" | "danger" | "success";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const ICONS: Readonly<Record<BannerTone, IoniconName>> = {
  info: "information-circle",
  warning: "alert-circle",
  danger: "close-circle",
  success: "checkmark-circle",
};

export interface BannerProps {
  readonly tone: BannerTone;
  readonly message: string;
  readonly detail?: string | null;
  readonly actionLabel?: string;
  readonly onAction?: (() => void) | undefined;
  /** Replaces the icon with a spinner — for "reconnecting…" style states. */
  readonly busy?: boolean;
}

export function Banner({
  tone,
  message,
  detail,
  actionLabel,
  onAction,
  busy = false,
}: BannerProps) {
  const theme = useTheme();
  const colors =
    tone === "danger"
      ? { fg: theme.colors.danger, bg: theme.colors.dangerSoft }
      : tone === "warning"
        ? { fg: theme.colors.warning, bg: theme.colors.warningSoft }
        : tone === "success"
          ? { fg: theme.colors.success, bg: theme.colors.successSoft }
          : { fg: theme.colors.accent, bg: theme.colors.accentSoft };

  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: colors.bg,
          borderRadius: theme.radii.md,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm + 2,
          gap: theme.spacing.sm,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.fg} />
      ) : (
        <Ionicons name={ICONS[tone]} size={17} color={colors.fg} />
      )}
      <View style={styles.body}>
        <Text variant="footnote" weight="600" style={{ color: colors.fg }}>
          {message}
        </Text>
        {detail ? (
          <Text variant="caption" color="secondary" numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={8}
          onPress={() => {
            haptic("light");
            onAction();
          }}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
        >
          <Text variant="footnote" weight="600" style={{ color: colors.fg }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center" },
  body: { flex: 1, gap: 1 },
});
