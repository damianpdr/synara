// FILE: threadTheme.ts
// Purpose: Tokens the thread screen needs beyond what src/ui/theme.ts exports today.
// Layer: Mobile thread UI
// Exports: threadColors, radius, fontSize, MONO_FONT, statusTone.
//
// `colors` / `spacing` are re-exported from src/ui/theme.ts unchanged so the
// thread screen and the app shell stay visually identical. Everything defined
// *here* is additive; when the design system grows these, this file collapses
// into a re-export. Nothing in src/ui/** is modified.

import { Platform } from "react-native";

import { colors, spacing } from "@/ui/theme";
import type { ThreadActivityStatus } from "@/features/thread/logic/threadStatus";

export { colors, spacing };

/** Hermes ships no font loader under Expo Go, so only platform fonts are safe. */
export const MONO_FONT = Platform.select({ ios: "Menlo", default: "monospace" });

export const threadColors = {
  /** Slightly lifted from `surface`, for the user's own message bubble. */
  userBubble: "#23261f",
  /** Tool rows and other muted chrome sit below the page, not above it. */
  sunken: "#131512",
  codeBackground: "#0b0c0a",
  diffAdd: "#9ae66e",
  diffAddBackground: "#16240f",
  diffRemove: "#ff8f85",
  diffRemoveBackground: "#2a1412",
  diffHunk: "#7fb4ff",
  running: "#f2c14e",
  attention: "#d6ff55",
  link: "#8ab4ff",
} as const;

export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;

export const fontSize = {
  micro: 10,
  caption: 11,
  small: 13,
  body: 15,
  title: 17,
  heading: 20,
} as const;

/** The colour the header pill and the composer border take for each status. */
export function statusTone(status: ThreadActivityStatus): string {
  switch (status) {
    case "running":
      return threadColors.running;
    case "awaiting-approval":
      return threadColors.attention;
    case "error":
      return colors.danger;
    case "idle":
      return colors.muted;
  }
}
