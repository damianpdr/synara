// FILE: ConnectView.tsx
// Purpose: Pair this phone with a Synara server (QR, pairing link, or host + code).
// Layer: Mobile connections feature
// Exports: ConnectView.
//
// One component serves both entry points: the first-run screen (`welcome`) and
// the "Add connection" modal (`modal`). They differ only in chrome — the same
// three pairing paths, the same diagnostics.

import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { diagnosePairingError } from "@/features/connections/pairingErrors";
import { useSynaraStore } from "@/state/synaraStore";
import { normalizeBaseUrl } from "@/transport/synaraAuth";
import { Banner } from "@/ui/Banner";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { haptic } from "@/ui/haptics";
import { QrScanner } from "@/ui/QrScanner";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { useTheme } from "@/ui/ThemeProvider";

type ManualMode = "code" | "token";

export interface ConnectViewProps {
  readonly variant: "welcome" | "modal";
  readonly onConnected?: (() => void) | undefined;
  readonly onCancel?: (() => void) | undefined;
}

export function ConnectView({ variant, onConnected, onCancel }: ConnectViewProps) {
  const theme = useTheme();
  const pairingBusy = useSynaraStore((state) => state.pairingBusy);
  const pairingError = useSynaraStore((state) => state.pairingError);
  const pairingHint = useSynaraStore((state) => state.pairingHint);
  const connectionStatus = useSynaraStore((state) => state.connection.status);
  const connectWithPairingUrl = useSynaraStore((state) => state.connectWithPairingUrl);
  const connectWithSessionToken = useSynaraStore((state) => state.connectWithSessionToken);

  const [pairingUrl, setPairingUrl] = useState("");
  const [host, setHost] = useState("");
  const [secret, setSecret] = useState("");
  const [manualMode, setManualMode] = useState<ManualMode>("code");
  const [showManual, setShowManual] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Fire the callback on the *transition* into "connected", never on the steady
  // state: a plain `status === "connected"` check dismisses the screen the
  // instant it opens when the user came here to re-pair.
  const wasConnected = useRef(connectionStatus === "connected");
  useEffect(() => {
    const isConnected = connectionStatus === "connected";
    if (isConnected && !wasConnected.current) {
      haptic("success");
      onConnected?.();
    }
    wasConnected.current = isConnected;
  }, [connectionStatus, onConnected]);

  const submitPairingUrl = useCallback(
    (value: string) => {
      setLocalError(null);
      void connectWithPairingUrl(value.trim());
    },
    [connectWithPairingUrl],
  );

  const submitManual = useCallback(() => {
    setLocalError(null);
    const trimmedHost = host.trim();
    const trimmedSecret = secret.trim();
    if (manualMode === "token") {
      void connectWithSessionToken(trimmedHost, trimmedSecret);
      return;
    }
    // A pairing code is the fragment of a pairing link; rebuilding the link
    // keeps one parsing path (`parsePairingUrl`) instead of two.
    try {
      const baseUrl = normalizeBaseUrl(trimmedHost);
      submitPairingUrl(`${baseUrl}/pair#token=${encodeURIComponent(trimmedSecret)}`);
    } catch (error) {
      const diagnosis = diagnosePairingError(error, trimmedHost);
      setLocalError(diagnosis.hint ? `${diagnosis.message} ${diagnosis.hint}` : diagnosis.message);
    }
  }, [connectWithSessionToken, host, manualMode, secret, submitPairingUrl]);

  const pasteFromClipboard = useCallback(() => {
    void (async () => {
      const value = (await Clipboard.getStringAsync()).trim();
      if (value.length === 0) return;
      haptic("light");
      setPairingUrl(value);
    })();
  }, []);

  if (scanning) {
    return (
      <QrScanner
        onCancel={() => setScanning(false)}
        onScanned={(value) => {
          setScanning(false);
          setPairingUrl(value);
          submitPairingUrl(value);
        }}
      />
    );
  }

  const manualReady = host.trim().length > 0 && secret.trim().length > 0;

  return (
    <Screen edges={variant === "welcome" ? ["top", "bottom"] : ["bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
        >
          {variant === "welcome" ? (
            <View style={{ gap: theme.spacing.sm, paddingTop: theme.spacing.xl }}>
              <Text variant="largeTitle">Connect to Synara</Text>
              <Text variant="callout" color="secondary">
                Pair this phone with a Synara server to follow your threads, approvals and sessions
                while you are away from the desk.
              </Text>
            </View>
          ) : null}

          {localError ? <Banner tone="danger" message={localError} /> : null}
          {pairingError ? (
            <Banner tone="danger" message={pairingError} detail={pairingHint} />
          ) : null}

          <View style={{ gap: theme.spacing.md }}>
            <Button
              label="Scan QR code"
              icon="qr-code-outline"
              onPress={() => setScanning(true)}
              disabled={pairingBusy}
            />

            <View style={[styles.divider, { gap: theme.spacing.md }]}>
              <View style={[styles.rule, { backgroundColor: theme.colors.separator }]} />
              <Text variant="caption" color="tertiary" uppercase>
                or paste the link
              </Text>
              <View style={[styles.rule, { backgroundColor: theme.colors.separator }]} />
            </View>

            <TextField
              label="Pairing link"
              value={pairingUrl}
              onChangeText={setPairingUrl}
              placeholder="http://100.x.y.z:3775/pair#token=…"
              keyboardType="url"
              textContentType="URL"
              returnKeyType="go"
              onSubmitEditing={() => submitPairingUrl(pairingUrl)}
            />
            <View style={[styles.actions, { gap: theme.spacing.md }]}>
              <Button
                label="Paste"
                variant="plain"
                icon="clipboard-outline"
                onPress={pasteFromClipboard}
              />
              <Button
                label="Pair"
                style={styles.flex}
                busy={pairingBusy}
                disabled={pairingUrl.trim().length === 0}
                onPress={() => submitPairingUrl(pairingUrl)}
              />
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              haptic("selection");
              setShowManual((value) => !value);
            }}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Text variant="subhead" color="accent">
              {showManual ? "Hide manual setup" : "Enter a host and code manually"}
            </Text>
          </Pressable>

          {showManual ? (
            <Card padded style={{ gap: theme.spacing.md }}>
              <Segmented
                value={manualMode}
                onChange={(next) => {
                  setManualMode(next);
                  setSecret("");
                }}
              />
              <TextField
                label="Server"
                value={host}
                onChangeText={setHost}
                placeholder="100.109.152.38:3775"
                keyboardType="url"
                autoComplete="off"
              />
              <TextField
                label={manualMode === "code" ? "Pairing code" : "Session token"}
                value={secret}
                onChangeText={setSecret}
                placeholder={manualMode === "code" ? "the part after #token=" : "eyJ2IjoxLCJr…"}
                secureTextEntry
                hint={
                  manualMode === "code"
                    ? "Single-use, expires in about five minutes."
                    : "A 30-day bearer session token, for servers you already have access to."
                }
              />
              <Button
                label={manualMode === "code" ? "Pair" : "Connect"}
                busy={pairingBusy}
                disabled={!manualReady}
                onPress={submitManual}
              />
            </Card>
          ) : null}

          <Card padded style={{ gap: theme.spacing.sm }}>
            <Text variant="label" color="tertiary" uppercase>
              Where do I get a pairing link?
            </Text>
            <Text variant="footnote" color="secondary">
              Your Synara server prints one on startup whenever it binds to a non-loopback address,
              and shows it as a QR code. Links are single-use and expire after about five minutes.
            </Text>
            <Text variant="footnote" color="secondary">
              To mint a fresh one, run this on the machine hosting Synara:
            </Text>
            <View
              style={[
                styles.code,
                {
                  backgroundColor: theme.colors.surfaceSunken,
                  borderRadius: theme.radii.sm,
                  padding: theme.spacing.sm,
                },
              ]}
            >
              <Text variant="caption" color="secondary" mono>
                curl -X POST http://HOST:3775/api/auth/pairing-token{"\n"}
                {"  "}-H &quot;Authorization: Bearer $SESSION_TOKEN&quot;
              </Text>
            </View>
          </Card>

          {onCancel ? <Button label="Cancel" variant="plain" onPress={onCancel} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Segmented({
  value,
  onChange,
}: {
  readonly value: ManualMode;
  readonly onChange: (value: ManualMode) => void;
}) {
  const theme = useTheme();
  const options: readonly { readonly key: ManualMode; readonly label: string }[] = [
    { key: "code", label: "Pairing code" },
    { key: "token", label: "Session token" },
  ];
  return (
    <View
      style={[
        styles.segmented,
        {
          backgroundColor: theme.colors.surfaceSunken,
          borderRadius: theme.radii.md,
          padding: 2,
        },
      ]}
    >
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => {
              haptic("selection");
              onChange(option.key);
            }}
            style={[
              styles.segment,
              {
                borderRadius: theme.radii.sm,
                paddingVertical: theme.spacing.sm,
                backgroundColor: selected ? theme.colors.surface : "transparent",
              },
            ]}
          >
            <Text
              variant="footnote"
              weight={selected ? "600" : "400"}
              color={selected ? "primary" : "secondary"}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  divider: { flexDirection: "row", alignItems: "center" },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  actions: { flexDirection: "row", alignItems: "center" },
  code: { width: "100%" },
  segmented: { flexDirection: "row" },
  segment: { flex: 1, alignItems: "center" },
});
