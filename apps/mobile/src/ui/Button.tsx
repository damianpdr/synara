// FILE: Button.tsx
// Purpose: Text button in three weights: filled, tinted, plain.
// Layer: Mobile UI
// Exports: Button.

import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from "react-native";

import { haptic, type HapticKind } from "@/ui/haptics";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/ThemeProvider";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: "filled" | "tinted" | "plain";
  readonly tone?: "accent" | "danger";
  readonly icon?: IoniconName;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly hapticKind?: HapticKind;
  readonly style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = "filled",
  tone = "accent",
  icon,
  disabled = false,
  busy = false,
  hapticKind = "light",
  style,
}: ButtonProps) {
  const theme = useTheme();
  const base = tone === "danger" ? theme.colors.danger : theme.colors.accent;
  const soft = tone === "danger" ? theme.colors.dangerSoft : theme.colors.accentSoft;
  const background = variant === "filled" ? base : variant === "tinted" ? soft : "transparent";
  const foreground = variant === "filled" ? theme.colors.onAccent : base;
  const isDisabled = disabled || busy;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={isDisabled}
      onPress={() => {
        haptic(hapticKind);
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: background,
          borderRadius: theme.radii.md,
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          gap: theme.spacing.sm,
          opacity: isDisabled ? 0.4 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={foreground} /> : null}
      {!busy && icon ? <Ionicons name={icon} size={17} color={foreground} /> : null}
      <View>
        <Text variant="headline" style={{ color: foreground }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
});
