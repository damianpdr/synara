// FILE: preferences.ts
// Purpose: Persist the handful of non-secret UI preferences the shell remembers.
// Layer: Mobile state
// Exports: AppearancePreference, Preferences, DEFAULT_PREFERENCES, loadPreferences,
//          savePreferences.
//
// Stored in expo-secure-store rather than AsyncStorage purely because
// SecureStore is already a dependency and ships inside Expo Go; these values
// are not secret. One JSON item, well under the ~2 KB per-item cap.

import * as SecureStore from "expo-secure-store";

const PREFERENCES_KEY = "synara.preferences";

export type AppearancePreference = "system" | "light" | "dark";

export interface Preferences {
  readonly appearance: AppearancePreference;
  readonly showArchived: boolean;
  /** Project ids whose list section the user collapsed. */
  readonly collapsedProjectIds: readonly string[];
}

export const DEFAULT_PREFERENCES: Preferences = {
  appearance: "system",
  showArchived: false,
  collapsedProjectIds: [],
};

function isAppearance(value: unknown): value is AppearancePreference {
  return value === "system" || value === "light" || value === "dark";
}

export async function loadPreferences(): Promise<Preferences> {
  try {
    const raw = await SecureStore.getItemAsync(PREFERENCES_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_PREFERENCES;
    const record = parsed as Record<string, unknown>;
    return {
      appearance: isAppearance(record["appearance"])
        ? record["appearance"]
        : DEFAULT_PREFERENCES.appearance,
      showArchived: record["showArchived"] === true,
      collapsedProjectIds: Array.isArray(record["collapsedProjectIds"])
        ? record["collapsedProjectIds"].filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Fire-and-forget from the store's setters: a failed preference write is not
 * worth interrupting the user for, and the in-memory value already applied.
 */
export async function savePreferences(preferences: Preferences): Promise<void> {
  try {
    await SecureStore.setItemAsync(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Ignored on purpose — see above.
  }
}
