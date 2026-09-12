// FILE: Card.tsx
// Purpose: Grouped surface — the iOS inset-list container.
// Layer: Mobile UI
// Exports: Card, CardDivider.

import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

import { useTheme } from "@/ui/ThemeProvider";

export interface CardProps {
  readonly children: ReactNode;
  readonly padded?: boolean;
  readonly elevated?: boolean;
  readonly style?: ViewStyle;
}

export function Card({ children, padded = false, elevated = false, style }: CardProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: elevated ? theme.colors.surfaceElevated : theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.lg,
        },
        padded ? { padding: theme.spacing.lg } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Hairline between rows of a card, inset from the leading edge like iOS. */
export function CardDivider({ inset = 0 }: { readonly inset?: number }) {
  const theme = useTheme();
  return (
    <View
      style={[styles.divider, { backgroundColor: theme.colors.separator, marginLeft: inset }]}
    />
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  divider: { height: StyleSheet.hairlineWidth },
});
