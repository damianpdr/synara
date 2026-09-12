// FILE: Text.tsx
// Purpose: Typed text primitive bound to the type ramp and the palette.
// Layer: Mobile UI
// Exports: Text, TextColor.

import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from "react-native";

import { useTheme } from "@/ui/ThemeProvider";
import type { Palette, TypeVariant } from "@/ui/tokens";

export type TextColor =
  | "primary"
  | "secondary"
  | "tertiary"
  | "accent"
  | "danger"
  | "success"
  | "warning"
  | "onAccent";

const COLOR_KEYS: Readonly<Record<TextColor, keyof Palette>> = {
  primary: "text",
  secondary: "textSecondary",
  tertiary: "textTertiary",
  accent: "accent",
  danger: "danger",
  success: "success",
  warning: "warning",
  onAccent: "onAccent",
};

export interface TextProps extends RNTextProps {
  readonly variant?: TypeVariant;
  readonly color?: TextColor;
  readonly uppercase?: boolean;
  readonly mono?: boolean;
  /** Overrides the ramp's weight without leaving it (e.g. a semibold body). */
  readonly weight?: TextStyle["fontWeight"];
}

export function Text({
  variant = "body",
  color = "primary",
  uppercase = false,
  mono = false,
  weight,
  style,
  ...rest
}: TextProps) {
  const theme = useTheme();
  const base = theme.typography[variant];
  const tone = theme.colors[COLOR_KEYS[color]];
  return (
    <RNText
      {...rest}
      style={[
        base,
        { color: typeof tone === "string" ? tone : theme.colors.text },
        uppercase ? UPPERCASE : null,
        mono ? { fontFamily: theme.fonts.mono } : null,
        weight ? { fontWeight: weight } : null,
        style,
      ]}
    />
  );
}

const UPPERCASE = { textTransform: "uppercase" } as const;
