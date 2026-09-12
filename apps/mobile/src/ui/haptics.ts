// FILE: haptics.ts
// Purpose: Fire-and-forget haptics that never crash a press handler.
// Layer: Mobile UI
// Exports: haptic.
//
// expo-haptics ships inside Expo Go, but the Taptic Engine is absent on the
// simulator and disabled system-wide by some accessibility settings. Every call
// is best-effort: a failed haptic must never break the interaction it decorates.

import * as Haptics from "expo-haptics";

export type HapticKind = "selection" | "light" | "medium" | "success" | "warning" | "error";

export function haptic(kind: HapticKind = "selection"): void {
  try {
    switch (kind) {
      case "selection":
        void Haptics.selectionAsync();
        return;
      case "light":
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      case "medium":
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return;
      case "success":
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      case "warning":
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      case "error":
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
    }
  } catch {
    // No Taptic Engine, or haptics are off. Nothing to do.
  }
}
