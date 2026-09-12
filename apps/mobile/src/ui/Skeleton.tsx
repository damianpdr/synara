// FILE: Skeleton.tsx
// Purpose: Placeholder block that breathes while first data is in flight.
// Layer: Mobile UI
// Exports: Skeleton, SkeletonThreadList.
//
// Uses RN's `Animated` rather than reanimated on purpose: a two-stop opacity
// loop needs nothing from a worklet runtime, and keeping reanimated off the
// launch path is one fewer way for Expo Go to surprise us.

import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View, type ViewStyle } from "react-native";

import { useTheme } from "@/ui/ThemeProvider";

export interface SkeletonProps {
  readonly width?: number | `${number}%`;
  readonly height?: number;
  readonly radius?: number;
  readonly style?: ViewStyle;
}

export function Skeleton({ width = "100%", height = 14, radius, style }: SkeletonProps) {
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius ?? theme.radii.sm,
          backgroundColor: theme.colors.skeleton,
          opacity: pulse,
        },
        style,
      ]}
    />
  );
}

/** The threads list's loading shape, so the first paint is not an empty canvas. */
export function SkeletonThreadList({ rows = 5 }: { readonly rows?: number }) {
  const theme = useTheme();
  return (
    <View style={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}>
      <Skeleton width="35%" height={11} />
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={[styles.row, { gap: theme.spacing.sm }]}>
          <Skeleton width={index % 2 === 0 ? "70%" : "52%"} height={16} />
          <Skeleton width="30%" height={11} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 2 },
});
