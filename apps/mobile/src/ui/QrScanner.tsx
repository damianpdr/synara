// FILE: QrScanner.tsx
// Purpose: Camera QR scanner for pairing links.
// Layer: Mobile UI
// Exports: QrScanner.
//
// expo-camera ships inside Expo Go, so this needs no custom native build. The
// camera permission prompt string lives in app.json (`NSCameraUsageDescription`).

import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef } from "react";
import { StyleSheet, View } from "react-native";

import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/ThemeProvider";

export function QrScanner({
  onScanned,
  onCancel,
}: {
  readonly onScanned: (value: string) => void;
  readonly onCancel: () => void;
}) {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  // `onBarcodeScanned` fires once per camera frame while the code is in view,
  // and unmounting the scanner is async. Without this latch a one-time pairing
  // credential gets redeemed once and then re-sent several times, so the phone
  // shows "pairing failed" while it is in fact already connected.
  const scanned = useRef(false);

  if (!permission) return <View style={[styles.fill, { backgroundColor: theme.colors.canvas }]} />;

  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.centered, { backgroundColor: theme.colors.canvas }]}>
        <EmptyState
          icon="camera-outline"
          title="Camera access needed"
          message="Synara scans the pairing QR code your server prints on startup. The camera is used for nothing else."
          actionLabel="Allow camera"
          onAction={() => void requestPermission()}
        />
        <Button label="Cancel" variant="plain" onPress={onCancel} />
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: "#000000" }]}>
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
      <View style={styles.overlay} pointerEvents="box-none">
        <View
          style={[
            styles.reticle,
            { borderColor: theme.colors.accent, borderRadius: theme.radii.xl },
          ]}
        />
        <View style={[styles.footer, { gap: theme.spacing.md, padding: theme.spacing.xl }]}>
          <Text variant="subhead" style={styles.hint}>
            Point the camera at the pairing QR code
          </Text>
          <Button label="Cancel" variant="tinted" onPress={onCancel} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { justifyContent: "center", alignItems: "center" },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "space-between",
  },
  reticle: {
    alignSelf: "center",
    marginTop: "35%",
    width: 232,
    height: 232,
    borderWidth: 2,
    opacity: 0.9,
  },
  footer: { alignItems: "stretch" },
  hint: { color: "#ffffff", textAlign: "center" },
});
