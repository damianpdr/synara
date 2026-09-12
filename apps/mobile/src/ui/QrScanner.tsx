// FILE: QrScanner.tsx
// Purpose: Camera QR scanner for pairing links.
// Layer: Mobile UI
// Exports: QrScanner.
//
// expo-camera ships inside Expo Go, so this needs no custom native build. The
// camera permission prompt string lives in app.json (`NSCameraUsageDescription`).

import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "@/ui/theme";

export function QrScanner({
  onScanned,
  onCancel,
}: {
  readonly onScanned: (value: string) => void;
  readonly onCancel: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  // `onBarcodeScanned` fires once per camera frame while the code is in view,
  // and unmounting the scanner is async. Without this latch a one-time pairing
  // credential gets redeemed once and then re-sent several times, so the phone
  // shows "pairing failed" while it is in fact already connected.
  const scanned = useRef(false);

  if (!permission) return <View style={styles.fill} />;

  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.centered]}>
        <Text style={styles.text}>Synara needs the camera to scan a pairing QR code.</Text>
        <Pressable style={styles.button} onPress={() => void requestPermission()}>
          <Text style={styles.buttonLabel}>Grant access</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={onCancel}>
          <Text style={styles.buttonLabel}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView
        style={styles.fill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={(event) => {
          if (scanned.current) return;
          scanned.current = true;
          onScanned(event.data);
        }}
      />
      <Pressable style={[styles.button, styles.overlayButton]} onPress={onCancel}>
        <Text style={styles.buttonLabel}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  centered: {
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
  },
  text: { color: colors.text, textAlign: "center" },
  button: {
    borderWidth: 1,
    borderColor: colors.accent,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: "center",
  },
  overlayButton: {
    position: "absolute",
    bottom: spacing.lg,
    alignSelf: "center",
    backgroundColor: colors.background,
  },
  buttonLabel: { color: colors.accent, fontWeight: "600" },
});
