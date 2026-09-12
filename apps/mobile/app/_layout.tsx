// FILE: _layout.tsx
// Purpose: Root navigator; hydrates stored credentials and mirrors AppState onto the socket.
// Layer: Mobile screens

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState } from "react-native";

import { useSynaraStore } from "@/state/synaraStore";
import { colors } from "@/ui/theme";

export default function RootLayout() {
  const hydrate = useSynaraStore((state) => state.hydrate);
  const pause = useSynaraStore((state) => state.pause);
  const resume = useSynaraStore((state) => state.resume);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    // The transport is AppState-agnostic; this is the only place that knows
    // about iOS lifecycle. Backgrounded sockets are killed by iOS anyway, so
    // dropping ours keeps the reconnect deliberate instead of accidental.
    const subscription = AppState.addEventListener("change", (next) => {
      // Only "background" tears the socket down. "inactive" fires for transient
      // overlays (Control Center, the app switcher, an incoming call banner),
      // and dropping the connection for those would churn it constantly.
      if (next === "active") resume();
      else if (next === "background") pause();
    });
    return () => subscription.remove();
  }, [pause, resume]);

  return (
    <>
      {/* eslint-disable-next-line react/style-prop-object -- expo-status-bar's
          `style` is a "light" | "dark" | "auto" enum, not a RN style object. */}
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Synara" }} />
        <Stack.Screen name="threads" options={{ title: "Threads" }} />
        <Stack.Screen name="thread/[id]" options={{ title: "Thread" }} />
      </Stack>
    </>
  );
}
