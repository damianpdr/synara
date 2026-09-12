// FILE: ThreadHeader.tsx
// Purpose: Thread title, branch, status pill, and the Changes button.
// Layer: Mobile thread UI
// Exports: ThreadHeader.
//
// The status pill reads the *same* `ThreadStatus` the threads list puts on the
// row (`src/features/shell/threadStatus.ts`), with the same label and the same
// palette entry, so opening a thread can never contradict the list you opened
// it from.

import { useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { threadStatusLabel, type ThreadStatus } from "@/features/shell/threadStatus";
import { fontSize, radius, spacing, useThreadTokens, type ThreadTokens } from "./threadTheme";

export function ThreadHeader({
  title,
  branch,
  status,
  disconnected,
  onBack,
  onOpenChanges,
  changesEnabled,
}: {
  readonly title: string;
  readonly branch: string | null;
  readonly status: ThreadStatus;
  readonly disconnected: boolean;
  readonly onBack: () => void;
  readonly onOpenChanges: () => void;
  readonly changesEnabled: boolean;
}) {
  const t = useThreadTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  const tone = t.status[status].fg;
  return (
    <View style={styles.root}>
      <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={24} color={t.colors.text} />
      </Pressable>

      <View style={styles.titleBlock}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.pill, { borderColor: tone }]}>
            {status === "running" ? (
              <ActivityIndicator size="small" color={tone} style={styles.spinner} />
            ) : (
              <View style={[styles.dot, { backgroundColor: t.status[status].dot }]} />
            )}
            <Text style={[styles.pillLabel, { color: tone }]}>{threadStatusLabel(status)}</Text>
          </View>
          {branch !== null ? (
            <Text style={styles.branch} numberOfLines={1}>
              <Ionicons name="git-branch-outline" size={11} color={t.colors.muted} /> {branch}
            </Text>
          ) : null}
          {/* Connection loss is separate from thread status: the thread may be
              "running" on the server while this phone cannot see it. */}
          {disconnected ? <Text style={styles.offline}>offline</Text> : null}
        </View>
      </View>

      <Pressable
        onPress={onOpenChanges}
        disabled={!changesEnabled}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Changes"
        accessibilityState={{ disabled: !changesEnabled }}
        style={[styles.changes, changesEnabled ? null : styles.changesDisabled]}
      >
        <Ionicons name="git-compare-outline" size={15} color={t.colors.text} />
        <Text style={styles.changesLabel}>Changes</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(t: ThreadTokens) {
  return StyleSheet.create({
    root: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingBottom: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.colors.border,
    },
    titleBlock: { flex: 1, gap: 3 },
    title: { color: t.colors.text, fontSize: fontSize.title, fontWeight: "600" },
    metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    dot: { width: 6, height: 6, borderRadius: 3 },
    spinner: { transform: [{ scale: 0.6 }], width: 8, height: 8 },
    pillLabel: { fontSize: fontSize.micro, letterSpacing: 0.8, textTransform: "uppercase" },
    branch: { flex: 1, color: t.colors.muted, fontSize: fontSize.caption },
    offline: { color: t.colors.danger, fontSize: fontSize.micro, textTransform: "uppercase" },
    changes: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
    },
    changesDisabled: { opacity: 0.4 },
    changesLabel: { color: t.colors.text, fontSize: fontSize.caption },
  });
}
