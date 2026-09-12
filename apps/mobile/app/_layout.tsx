// FILE: _layout.tsx
// Purpose: Root navigator, theme host, app-lifecycle owner, terminal-verdict gate.
// Layer: Mobile screens

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { FatalScreen } from "@/features/shell/FatalScreen";
import { useAppLifecycle } from "@/features/shell/useAppLifecycle";
import { useSynaraStore } from "@/state/synaraStore";
import { ThemeProvider, useTheme } from "@/ui/ThemeProvider";

export default function RootLayout() {
  const hydrate = useSynaraStore((state) => state.hydrate);
  const appearance = useSynaraStore((state) => state.appearance);
  const probeConnection = useSynaraStore((state) => state.probeConnection);
  const reconnectNow = useSynaraStore((state) => state.reconnectNow);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useAppLifecycle({ probe: probeConnection, reconnect: reconnectNow });

  // Deliberately NOT wrapped in `GestureHandlerRootView`: nothing in the shell
  // uses react-native-gesture-handler (the native stack's swipe-back and the
  // form sheet are native), and importing it drags in the Worklets babel plugin,
  // which currently fails against this monorepo's hoisted @babel/core 8.
  return (
    <SafeAreaProvider>
      <ThemeProvider appearance={appearance}>
        <RootChrome />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function RootChrome() {
  const theme = useTheme();
  const connection = useSynaraStore((state) => state.connection);
  const reconnectNow = useSynaraStore((state) => state.reconnectNow);
  const disconnect = useSynaraStore((state) => state.disconnect);

  // A terminal protocol verdict is not something any screen can render around,
  // so it covers the navigator instead of being routed to: the stack keeps its
  // state and simply reappears if the retry succeeds.
  const blocked =
    connection.status === "fatal" &&
    (connection.fatalAction === "update-client" || connection.fatalAction === "update-server");

  return (
    <View style={FILL}>
      <StatusBar style={theme.scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.canvas },
          headerTintColor: theme.colors.accent,
          headerTitleStyle: { color: theme.colors.text },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.colors.canvas },
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: "Threads",
            headerLargeTitle: true,
            headerLargeTitleStyle: { color: theme.colors.text },
          }}
        />
        <Stack.Screen name="thread/[id]" options={{ title: "Thread" }} />
        <Stack.Screen
          name="connect/index"
          options={{ title: "Add connection", presentation: "modal" }}
        />
        <Stack.Screen
          name="settings/index"
          options={{ title: "Settings", presentation: "modal" }}
        />
        <Stack.Screen
          name="new-thread"
          options={{ title: "New thread", presentation: "formSheet" }}
        />
      </Stack>
      {blocked ? (
        <View style={OVERLAY}>
          <FatalScreen
            connection={connection}
            onRetry={reconnectNow}
            onDisconnect={() => void disconnect()}
          />
        </View>
      ) : null}
    </View>
  );
}

const FILL = { flex: 1 } as const;
const OVERLAY = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const;
