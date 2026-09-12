// FILE: PressableRow.tsx
// Purpose: Tappable list row with the iOS press tint and a selection haptic.
// Layer: Mobile UI
// Exports: PressableRow.

import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";

import { haptic, type HapticKind } from "@/ui/haptics";
import { useTheme } from "@/ui/ThemeProvider";

export interface PressableRowProps {
  readonly children: ReactNode;
  readonly onPress?: (() => void) | undefined;
  readonly onLongPress?: (() => void) | undefined;
  readonly disabled?: boolean;
  /** Trailing disclosure chevron; on by default when the row navigates. */
  readonly chevron?: boolean;
  readonly hapticKind?: HapticKind;
  readonly accessibilityLabel?: string;
  readonly style?: ViewStyle;
}

export function PressableRow({
  children,
  onPress,
  onLongPress,
  disabled = false,
  chevron,
  hapticKind = "selection",
  accessibilityLabel,
  style,
}: PressableRowProps) {
  const theme = useTheme();
  const showChevron = chevron ?? onPress !== undefined;
  return (
    <Pressable
      accessibilityRole="button"
      {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })}
      disabled={disabled || onPress === undefined}
      // The haptic fires on press-in, not on release: that is when iOS itself
      // ticks, and waiting for onPress makes the feedback feel late.
      onPressIn={() => {
        if (!disabled && onPress) haptic(hapticKind);
      }}
      {...(onPress === undefined ? {} : { onPress })}
      {...(onLongPress === undefined ? {} : { onLongPress })}
      style={({ pressed }) => [
        styles.row,
        {
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
          gap: theme.spacing.md,
          backgroundColor: pressed ? theme.colors.surfaceSunken : "transparent",
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      <View style={styles.content}>{children}</View>
      {showChevron ? (
        <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  content: { flex: 1 },
});
