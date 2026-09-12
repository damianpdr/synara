// FILE: theme.ts
// Purpose: Legacy flat token aliases kept for screens that have not moved to `tokens.ts`.
// Layer: Mobile UI
// Exports: colors, spacing.
//
// DEPRECATED for new code — use `@/ui/tokens` + `useTheme()` instead, which is
// light/dark aware. These constants are the DARK palette only, kept because
// they are imported by screens owned elsewhere; removing the names would break
// those files. The values below track `darkPalette`, so a screen using them
// still looks like the rest of the app in dark mode.

import { darkPalette } from "@/ui/tokens";

export const colors = {
  background: darkPalette.canvas,
  surface: darkPalette.surface,
  border: darkPalette.border,
  text: darkPalette.text,
  muted: darkPalette.textSecondary,
  accent: darkPalette.accent,
  danger: darkPalette.danger,
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24 } as const;
