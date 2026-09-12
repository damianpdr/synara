// FILE: theme.ts
// Purpose: The handful of shared tokens the v1 screens need.
// Layer: Mobile UI
// Exports: colors, spacing.

export const colors = {
  background: "#10110f",
  surface: "#171915",
  border: "#373a34",
  text: "#f3f0e8",
  muted: "#b8bbb2",
  accent: "#d6ff55",
  danger: "#ff6b5e",
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24 } as const;
