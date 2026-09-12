// FILE: SectionHeader.tsx
// Purpose: Grouped-list section header, optionally a collapse toggle.
// Layer: Mobile UI
// Exports: SectionHeader.

import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { haptic } from "@/ui/haptics";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/ThemeProvider";

export interface SectionHeaderProps {
  readonly title: string;
  readonly count?: number | undefined;
  readonly accessory?: ReactNode;
  readonly onPress?: (() => void) | undefined;
  readonly collapsed?: boolean | undefined;
}

export function SectionHeader({ title, count, accessory, onPress, collapsed }: SectionHeaderProps) {
  const theme = useTheme();
  const body = (
    <View
      style={[
        styles.header,
        {
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.xl,
          paddingBottom: theme.spacing.sm,
          gap: theme.spacing.sm,
        },
      ]}
    >
      {collapsed === undefined ? null : (
        <Ionicons
          // Rotation is expressed as two glyphs rather than an animated
          // transform: a chevron that snaps is honest about a list that
          // re-lays-out instantly.
          name={collapsed ? "chevron-forward" : "chevron-down"}
          size={13}
          color={theme.colors.textTertiary}
        />
      )}
      <Text variant="label" color="secondary" uppercase numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      {count === undefined ? null : (
        <Text variant="label" color="tertiary">
          {count}
        </Text>
      )}
      {accessory}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${collapsed === true ? "collapsed" : "expanded"}`}
      onPress={() => {
        haptic("selection");
        onPress();
      }}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  title: { flexShrink: 1 },
});
