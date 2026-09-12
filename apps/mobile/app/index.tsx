// FILE: index.tsx
// Purpose: Connection screen — pair by QR, pairing URL, or host + session token.
// Layer: Mobile screens

import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useSynaraStore } from "@/state/synaraStore";
import { QrScanner } from "@/ui/QrScanner";
import { StatusPill } from "@/ui/StatusPill";
import { colors, spacing } from "@/ui/theme";

export default function ConnectScreen() {
  const { baseUrl, connection, pairingBusy, pairingError } = useSynaraStore();
  const connectWithPairingUrl = useSynaraStore((state) => state.connectWithPairingUrl);
  const connectWithSessionToken = useSynaraStore((state) => state.connectWithSessionToken);
  const disconnect = useSynaraStore((state) => state.disconnect);

  const [pairingUrl, setPairingUrl] = useState("");
  const [host, setHost] = useState("");
  const [token, setToken] = useState("");
  const [scanning, setScanning] = useState(false);

  // Navigate on the *transition* into "connected", never on the steady state:
  // a plain `status === "connected"` check bounces the user straight back to
  // /threads whenever they open this screen to re-pair or switch servers.
  const wasConnected = useRef(connection.status === "connected");
  useEffect(() => {
    const isConnected = connection.status === "connected";
    if (isConnected && !wasConnected.current) router.replace("/threads");
    wasConnected.current = isConnected;
  }, [connection.status]);

  if (scanning) {
    return (
      <QrScanner
        onCancel={() => setScanning(false)}
        onScanned={(value) => {
          setScanning(false);
          setPairingUrl(value);
          void connectWithPairingUrl(value);
        }}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <StatusPill status={connection.status} />
      {baseUrl ? <Text style={styles.muted}>Paired with {baseUrl}</Text> : null}
      {connection.lastError ? <Text style={styles.error}>{connection.lastError}</Text> : null}
      {pairingError ? <Text style={styles.error}>{pairingError}</Text> : null}

      <Text style={styles.heading}>Pair with a Synara server</Text>
      <Pressable style={styles.button} onPress={() => setScanning(true)}>
        <Text style={styles.buttonLabel}>Scan QR</Text>
      </Pressable>

      <Text style={styles.label}>Pairing URL</Text>
      <TextInput
        style={styles.input}
        value={pairingUrl}
        onChangeText={setPairingUrl}
        placeholder="http://100.x.y.z:3775/pair#token=..."
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable
        style={styles.button}
        disabled={pairingBusy || pairingUrl.trim().length === 0}
        onPress={() => void connectWithPairingUrl(pairingUrl)}
      >
        <Text style={styles.buttonLabel}>Pair</Text>
      </Pressable>

      <Text style={styles.heading}>Or use an existing session token</Text>
      <Text style={styles.label}>Server</Text>
      <TextInput
        style={styles.input}
        value={host}
        onChangeText={setHost}
        placeholder="http://100.x.y.z:3775"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.label}>Session token</Text>
      <TextInput
        style={styles.input}
        value={token}
        onChangeText={setToken}
        placeholder="eyJ2IjoxLCJr..."
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
      <Pressable
        style={styles.button}
        disabled={pairingBusy || host.trim().length === 0 || token.trim().length === 0}
        onPress={() => void connectWithSessionToken(host, token)}
      >
        <Text style={styles.buttonLabel}>Connect</Text>
      </Pressable>

      {pairingBusy ? <ActivityIndicator color={colors.accent} /> : null}

      {baseUrl ? (
        <Pressable style={styles.secondary} onPress={() => void disconnect()}>
          <Text style={styles.secondaryLabel}>Forget this server</Text>
        </Pressable>
      ) : null}
      <View style={{ height: spacing.lg }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.background },
  heading: { color: colors.text, fontSize: 18, fontWeight: "600", marginTop: spacing.md },
  label: { color: colors.muted, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  muted: { color: colors.muted, fontSize: 13 },
  error: { color: colors.danger, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    padding: spacing.sm,
  },
  button: {
    borderWidth: 1,
    borderColor: colors.accent,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  buttonLabel: { color: colors.accent, fontWeight: "600" },
  secondary: { paddingVertical: spacing.sm, alignItems: "center" },
  secondaryLabel: { color: colors.danger },
});
