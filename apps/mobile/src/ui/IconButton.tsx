// FILE: IconButton.tsx
// Purpose: Icon-only control sized for a thumb, used in headers and rows.
// Layer: Mobile UI
// Exports: IconButton.

import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from "react-native";

import { haptic, type HapticKind } from "@/ui/haptics";
import { useTheme } from "@/ui/ThemeProvider";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

export interface IconButtonProps {
  readonly name: IoniconName;
  readonly onPress: () => void;
  readonly accessibilityLabel: string;
  readonly size?: number;
  readonly tone?: "accent" | "secondary" | "danger";
  readonly disabled?: boolean;
  readonly busy?: boolean;
  /** Tinted circular background — for a primary action sitting on the canvas. */
  readonly filled?: boolean;
  readonly hapticKind?: HapticKind;
  readonly style?: ViewStyle;
}

export function IconButton({
  name,
  onPress,
  accessibilityLabel,
  size = 22,
  tone = "accent",
  disabled = false,
  busy = false,
  filled = false,
  hapticKind = "light",
  style,
}: IconButtonProps) {
  const theme = useTheme();
  const color =
    tone === "danger"
      ? theme.colors.danger
      : tone === "secondary"
        ? theme.colors.textSecondary
        : theme.colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled || busy}
      hitSlop={10}
      onPress={() => {
        haptic(hapticKind);
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        filled
          ? {
              backgroundColor: theme.colors.accentSoft,
              borderRadius: theme.radii.pill,
              padding: theme.spacing.sm,
            }
          : null,
        { opacity: disabled ? 0.35 : pressed ? 0.5 : 1 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <Ionicons name={name} size={size} color={color} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: "center", justifyContent: "center" },
});
