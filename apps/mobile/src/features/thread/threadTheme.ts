// FILE: threadTheme.ts
// Purpose: Light/dark tokens for the thread screen, on top of the design system.
// Layer: Mobile thread UI
// Exports: ThreadTokens, resolveThreadTokens, useThreadTokens, spacing, radius,
//          fontSize, MONO_FONT.
//
// The thread screen was built against a flat, dark-only token set while the
// shell was gaining `src/ui/tokens.ts` + `ThemeProvider`. This file is the
// bridge: the same names the thread components already use, resolved per color
// scheme from the shared palettes, so the appearance preference in Settings
// (system / light / dark) reaches the thread screen too.
//
// The DARK values are deliberately byte-identical to what the thread feature
// shipped with: that is the only rendering anyone has had a chance to look at,
// so this refactor must be a no-op there. (No unit test pins them — this module
// imports `react-native`, which the node-environment vitest setup deliberately
// does not carry.) The LIGHT values are derived from `lightPalette` rather than
// invented, so the thread screen cannot drift into its own private light theme.

import { useMemo } from "react";
import { Platform } from "react-native";

import type { ThreadStatus } from "@/features/shell/threadStatus";
import { useTheme } from "@/ui/ThemeProvider";
import {
  darkPalette,
  lightPalette,
  type ColorScheme,
  type Palette,
  type StatusTone,
} from "@/ui/tokens";

/** Hermes ships no font loader under Expo Go, so only platform fonts are safe. */
export const MONO_FONT = Platform.select({ ios: "Menlo", default: "monospace" });

/**
 * The thread screen's own spacing scale, which predates and differs from
 * `tokens.ts`'s 4pt grid (`md` here is 16, there it is 12). Kept as-is: every
 * measurement on this screen was chosen against it.
 */
export const spacing = { xs: 4, sm: 8, md: 16, lg: 24 } as const;

export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;

export const fontSize = {
  micro: 10,
  caption: 11,
  small: 13,
  body: 15,
  title: 17,
  heading: 20,
} as const;

/** The flat colour names the thread components were written against. */
export interface ThreadBaseColors {
  readonly background: string;
  readonly surface: string;
  readonly border: string;
  readonly text: string;
  readonly muted: string;
  readonly accent: string;
  readonly danger: string;
}

export interface ThreadAccentColors {
  /** Slightly lifted from `surface`, for the user's own message bubble. */
  readonly userBubble: string;
  /** Tool rows and other muted chrome sit below the page, not above it. */
  readonly sunken: string;
  readonly codeBackground: string;
  readonly diffAdd: string;
  readonly diffAddBackground: string;
  readonly diffRemove: string;
  readonly diffRemoveBackground: string;
  readonly diffHunk: string;
  readonly running: string;
  /** The "look at me" fill: Send, the streaming caret, the plan card border. */
  readonly attention: string;
  /** Foreground for anything sitting *on* `attention`. */
  readonly onAttention: string;
  readonly link: string;
}

export interface ThreadTokens {
  readonly scheme: ColorScheme;
  readonly colors: ThreadBaseColors;
  readonly threadColors: ThreadAccentColors;
  /** Shared with the threads list, so the header pill matches the row pill. */
  readonly status: Readonly<Record<ThreadStatus, StatusTone>>;
}

function baseColors(palette: Palette): ThreadBaseColors {
  return {
    background: palette.canvas,
    surface: palette.surface,
    border: palette.border,
    text: palette.text,
    muted: palette.textSecondary,
    accent: palette.accent,
    danger: palette.danger,
  };
}

const DARK: ThreadTokens = {
  scheme: "dark",
  colors: baseColors(darkPalette),
  threadColors: {
    userBubble: "#23261f",
    sunken: "#131512",
    codeBackground: "#0b0c0a",
    diffAdd: "#9ae66e",
    diffAddBackground: "#16240f",
    diffRemove: "#ff8f85",
    diffRemoveBackground: "#2a1412",
    diffHunk: "#7fb4ff",
    running: "#f2c14e",
    attention: "#d6ff55",
    onAttention: darkPalette.canvas,
    link: "#8ab4ff",
  },
  status: darkPalette.status,
};

// Nothing here is a new hue: the dark screen's lime/amber accents have no light
// equivalent that stays legible on white, so light mode leans on the palette
// the rest of the app already uses on a light canvas.
const LIGHT: ThreadTokens = {
  scheme: "light",
  colors: baseColors(lightPalette),
  threadColors: {
    userBubble: lightPalette.accentSoft,
    sunken: lightPalette.surfaceSunken,
    codeBackground: lightPalette.surfaceSunken,
    diffAdd: lightPalette.success,
    diffAddBackground: lightPalette.successSoft,
    diffRemove: lightPalette.danger,
    diffRemoveBackground: lightPalette.dangerSoft,
    diffHunk: lightPalette.accent,
    running: lightPalette.status.running.dot,
    attention: lightPalette.accent,
    onAttention: lightPalette.onAccent,
    link: lightPalette.accent,
  },
  status: lightPalette.status,
};

const THREAD_TOKENS: Readonly<Record<ColorScheme, ThreadTokens>> = { light: LIGHT, dark: DARK };

/** Stable identity per scheme, so `useMemo(..., [tokens])` over a style sheet holds. */
export function resolveThreadTokens(scheme: ColorScheme): ThreadTokens {
  return THREAD_TOKENS[scheme];
}

export function useThreadTokens(): ThreadTokens {
  const scheme = useTheme().scheme;
  return useMemo(() => resolveThreadTokens(scheme), [scheme]);
}
