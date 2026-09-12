// FILE: ThemeProvider.tsx
// Purpose: Resolve the active theme from the OS scheme + the user's preference.
// Layer: Mobile UI
// Exports: ThemeProvider, useTheme, resolveScheme.

import { createContext, use, type ReactNode } from "react";
import { useColorScheme } from "react-native";

import type { AppearancePreference } from "@/state/preferences";
import { resolveTheme, type ColorScheme, type Theme } from "@/ui/tokens";

const ThemeContext = createContext<Theme>(resolveTheme("dark"));

export function resolveScheme(
  preference: AppearancePreference,
  /** `useColorScheme()` widens to `ColorSchemeName`, which includes "unspecified". */
  systemScheme: string | null | undefined,
): ColorScheme {
  if (preference === "light" || preference === "dark") return preference;
  // `useColorScheme()` is null before the OS answers; dark is the better guess
  // for a tool people open at night and avoids a white flash on launch.
  return systemScheme === "light" ? "light" : "dark";
}

export function ThemeProvider({
  appearance,
  children,
}: {
  readonly appearance: AppearancePreference;
  readonly children: ReactNode;
}) {
  const systemScheme = useColorScheme();
  const theme = resolveTheme(resolveScheme(appearance, systemScheme));
  return <ThemeContext value={theme}>{children}</ThemeContext>;
}

export function useTheme(): Theme {
  return use(ThemeContext);
}
