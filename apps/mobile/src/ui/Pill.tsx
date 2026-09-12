// FILE: Pill.tsx
// Purpose: Status pill / badge / dot in the shared status tones.
// Layer: Mobile UI
// Exports: Pill, Dot, Chip, PillTone.

import { StyleSheet, View, type ViewStyle } from "react-native";

import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/ThemeProvider";
import type { StatusTone, Theme } from "@/ui/tokens";

export type PillTone = "neutral" | "accent" | "success" | "warning" | "danger";

function toneOf(theme: Theme, tone: PillTone): StatusTone {
  switch (tone) {
    case "accent":
      return { fg: theme.colors.accent, bg: theme.colors.accentSoft, dot: theme.colors.accent };
    case "success":
      return { fg: theme.colors.success, bg: theme.colors.successSoft, dot: theme.colors.success };
    case "warning":
      return { fg: theme.colors.warning, bg: theme.colors.warningSoft, dot: theme.colors.warning };
    case "danger":
      return { fg: theme.colors.danger, bg: theme.colors.dangerSoft, dot: theme.colors.danger };
    case "neutral":
      return theme.colors.status.idle;
  }
}

export interface PillProps {
  readonly label: string;
  /** Either a semantic tone name or an explicit triple (thread status colors). */
  readonly tone?: PillTone | StatusTone;
  readonly dot?: boolean;
  readonly style?: ViewStyle;
}

export function Pill({ label, tone = "neutral", dot = false, style }: PillProps) {
  const theme = useTheme();
  const resolved = typeof tone === "string" ? toneOf(theme, tone) : tone;
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: resolved.bg,
          borderRadius: theme.radii.pill,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: 3,
          gap: theme.spacing.xs + 1,
        },
        style,
      ]}
    >
      {dot ? <View style={[styles.dot, { backgroundColor: resolved.dot }]} /> : null}
      <Text variant="label" uppercase style={{ color: resolved.fg }}>
        {label}
      </Text>
    </View>
  );
}

export function Dot({ color, size = 8 }: { readonly color: string; readonly size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
  );
}

/**
 * Low-contrast metadata chip (branch names, model ids). Monospaced, because the
 * content is code-shaped and the shape is the point.
 */
export function Chip({ label, icon }: { readonly label: string; readonly icon?: string }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: theme.colors.surfaceSunken,
          borderRadius: theme.radii.sm,
          paddingHorizontal: theme.spacing.sm - 2,
          paddingVertical: 2,
          gap: theme.spacing.xxs,
        },
      ]}
    >
      <Text variant="caption" color="secondary" mono numberOfLines={1}>
        {icon ? `${icon} ` : ""}
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start" },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
