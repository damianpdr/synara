// FILE: Screen.tsx
// Purpose: Root container for a screen — canvas background plus safe-area edges.
// Layer: Mobile UI
// Exports: Screen.

import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { useTheme } from "@/ui/ThemeProvider";

export interface ScreenProps {
  readonly children: ReactNode;
  /**
   * Defaults to the bottom edge only: inside a native stack the header already
   * owns the top inset, and insetting twice leaves a dead band under the
   * status bar.
   */
  readonly edges?: readonly Edge[];
  readonly padded?: boolean;
  readonly style?: ViewStyle;
}

const DEFAULT_EDGES: readonly Edge[] = ["bottom"];

export function Screen({ children, edges = DEFAULT_EDGES, padded = false, style }: ScreenProps) {
  const theme = useTheme();
  return (
    <SafeAreaView edges={edges} style={[styles.root, { backgroundColor: theme.colors.canvas }]}>
      <View style={[styles.body, padded ? { padding: theme.spacing.lg } : null, style]}>
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
});
