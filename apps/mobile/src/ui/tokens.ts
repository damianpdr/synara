// FILE: tokens.ts
// Purpose: The design tokens every mobile surface is built from.
// Layer: Mobile UI
// Exports: Theme, Palette, StatusTone, lightPalette, darkPalette, spacing, radii,
//          typography, fonts, shadows, resolveTheme.
//
// Colors are derived from Synara's web theme so the phone reads as the same
// product: `apps/web/src/index.css` (`--background` #fcfcfc / #0e0e0e,
// `--foreground` neutral-800 / neutral-100) and the `synara` seed in
// `apps/web/src/theme/theme.seed.generated.ts` (accent #526fff light /
// #6073cc dark, ink #262626 / #f5f5f5, diff green #00a240 / #40c977, diff red
// #ba2623 / #fa423e, skill violet #924ff7 / #ad7bf9).
//
// Two deliberate departures, both for the phone:
//   - The light canvas is a step darker than the web's #fcfcfc. On a laptop the
//     web app separates cards from the page with a hairline; at arm's length on
//     glass that hairline disappears, so cards sit on a tinted canvas instead.
//   - The dark accent is #6073cc lifted to #6e82de. The seed value is chosen
//     for a chrome that sits behind content; as interactive *text* on near-black
//     it lands under 4.5:1, and this app puts the accent on labels and buttons.
//
// No gradients, no borrowed Material elevation: iOS surfaces are flat fills
// separated by hairlines, with shadow reserved for things that actually float.

import { Platform } from "react-native";

import type { ThreadStatus } from "@/features/shell/threadStatus";

/** Foreground / tinted-background / indicator-dot triple for one semantic state. */
export interface StatusTone {
  readonly fg: string;
  readonly bg: string;
  readonly dot: string;
}

export interface Palette {
  /** Page background behind everything. */
  readonly canvas: string;
  /** Cards and list rows. */
  readonly surface: string;
  /** Sheets, popovers, pressed rows. */
  readonly surfaceElevated: string;
  /** Inputs and inset wells. */
  readonly surfaceSunken: string;
  readonly border: string;
  readonly separator: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly textTertiary: string;
  readonly accent: string;
  readonly accentSoft: string;
  readonly onAccent: string;
  readonly danger: string;
  readonly dangerSoft: string;
  readonly warning: string;
  readonly warningSoft: string;
  readonly success: string;
  readonly successSoft: string;
  readonly skeleton: string;
  readonly scrim: string;
  readonly status: Readonly<Record<ThreadStatus, StatusTone>>;
}

export const lightPalette: Palette = {
  canvas: "#f2f2f5",
  surface: "#ffffff",
  surfaceElevated: "#ffffff",
  surfaceSunken: "#ececed",
  border: "rgba(0, 0, 0, 0.08)",
  separator: "rgba(0, 0, 0, 0.06)",
  text: "#1f1f22",
  textSecondary: "#6b6b72",
  textTertiary: "#9a9aa1",
  accent: "#526fff",
  accentSoft: "rgba(82, 111, 255, 0.10)",
  onAccent: "#ffffff",
  danger: "#ba2623",
  dangerSoft: "rgba(186, 38, 35, 0.10)",
  warning: "#8a5300",
  warningSoft: "rgba(245, 158, 11, 0.14)",
  success: "#00a240",
  successSoft: "rgba(0, 162, 64, 0.10)",
  skeleton: "rgba(0, 0, 0, 0.07)",
  scrim: "rgba(0, 0, 0, 0.35)",
  status: {
    "needs-approval": { fg: "#8a5300", bg: "rgba(245, 158, 11, 0.14)", dot: "#f59e0b" },
    "needs-input": { fg: "#6b21d9", bg: "rgba(146, 79, 247, 0.12)", dot: "#924ff7" },
    error: { fg: "#b42318", bg: "rgba(186, 38, 35, 0.10)", dot: "#e5484d" },
    running: { fg: "#3a54d8", bg: "rgba(82, 111, 255, 0.10)", dot: "#526fff" },
    idle: { fg: "#6b6b72", bg: "rgba(0, 0, 0, 0.05)", dot: "#a3a3a8" },
  },
};

export const darkPalette: Palette = {
  canvas: "#0e0e0e",
  surface: "#161617",
  surfaceElevated: "#1e1e20",
  surfaceSunken: "#1a1a1c",
  border: "rgba(255, 255, 255, 0.09)",
  separator: "rgba(255, 255, 255, 0.07)",
  text: "#f5f5f5",
  textSecondary: "#a1a1a6",
  textTertiary: "#727277",
  accent: "#6e82de",
  accentSoft: "rgba(110, 130, 222, 0.16)",
  onAccent: "#0e0e0e",
  danger: "#fa423e",
  dangerSoft: "rgba(250, 66, 62, 0.14)",
  warning: "#f0b429",
  warningSoft: "rgba(240, 180, 41, 0.14)",
  success: "#40c977",
  successSoft: "rgba(64, 201, 119, 0.14)",
  skeleton: "rgba(255, 255, 255, 0.07)",
  scrim: "rgba(0, 0, 0, 0.55)",
  status: {
    "needs-approval": { fg: "#f0b429", bg: "rgba(240, 180, 41, 0.14)", dot: "#f0b429" },
    "needs-input": { fg: "#bc93fa", bg: "rgba(173, 123, 249, 0.14)", dot: "#ad7bf9" },
    error: { fg: "#ff6b64", bg: "rgba(250, 66, 62, 0.14)", dot: "#fa423e" },
    running: { fg: "#8da0f0", bg: "rgba(110, 130, 222, 0.16)", dot: "#6e82de" },
    idle: { fg: "#8e8e93", bg: "rgba(255, 255, 255, 0.06)", dot: "#6e6e73" },
  },
};

/** 4pt grid. `md` (12) is the default gap inside a component, `lg` (16) between them. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

/**
 * `undefined` fontFamily is the system font (San Francisco on iOS) with all of
 * its optical sizing and Dynamic Type metrics intact; naming it explicitly
 * would opt out of that.
 */
export const fonts = {
  mono: Platform.select({ ios: "Menlo", default: "monospace" }) ?? "monospace",
} as const;

export interface TypeStyle {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontWeight: "400" | "500" | "600" | "700";
  readonly letterSpacing?: number;
}

/** Named after the iOS type ramp so sizes stay recognisably native. */
export const typography = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "700", letterSpacing: 0.37 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "700", letterSpacing: -0.2 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600", letterSpacing: -0.4 },
  body: { fontSize: 17, lineHeight: 22, fontWeight: "400", letterSpacing: -0.4 },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: "400", letterSpacing: -0.3 },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: "400", letterSpacing: -0.2 },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: "400" },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "400" },
  /** Micro uppercase label for section headers and chips. */
  label: { fontSize: 11, lineHeight: 14, fontWeight: "600", letterSpacing: 0.6 },
} as const satisfies Record<string, TypeStyle>;

export type TypeVariant = keyof typeof typography;

/** Reserved for things that genuinely float: sheets and the floating banner. */
export const shadows = {
  floating: {
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
} as const;

export type ColorScheme = "light" | "dark";

export interface Theme {
  readonly scheme: ColorScheme;
  readonly colors: Palette;
  readonly spacing: typeof spacing;
  readonly radii: typeof radii;
  readonly typography: typeof typography;
  readonly fonts: typeof fonts;
  readonly shadows: typeof shadows;
}

const THEMES: Readonly<Record<ColorScheme, Theme>> = {
  light: {
    scheme: "light",
    colors: lightPalette,
    spacing,
    radii,
    typography,
    fonts,
    shadows,
  },
  dark: {
    scheme: "dark",
    colors: darkPalette,
    spacing,
    radii,
    typography,
    fonts,
    shadows,
  },
};

/** Stable identity per scheme, so `useMemo(..., [theme])` in primitives works. */
export function resolveTheme(scheme: ColorScheme): Theme {
  return THEMES[scheme];
}
