// FILE: DiffSheet.tsx
// Purpose: Read-only modal showing the latest turn's unified diff.
// Layer: Mobile thread UI
// Exports: DiffSheet.
//
// Minimal by design: plain unified text in a monospace font with +/- colouring
// and file headers as section titles. No syntax highlighting, no side-by-side,
// no staging — apps/web owns the rich diff surface. Parsing lives in
// src/features/thread/logic/diff.ts and is unit tested there.
//
// oxlint-disable react/no-array-index-key -- diff lines are positional and the
// section is rebuilt wholesale on every fetch; duplicate line text is common
// (blank lines, repeated braces), so the index is the only stable key.

import { useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import type { ThreadId } from "@synara/contracts";

import { parseUnifiedDiff, type DiffLine } from "@/features/thread/logic/diff";
import { useThreadStore } from "@/state/threadStore";
import {
  fontSize,
  MONO_FONT,
  radius,
  spacing,
  useThreadTokens,
  type ThreadTokens,
} from "./threadTheme";

export function DiffSheet({
  threadId,
  visible,
  onClose,
}: {
  readonly threadId: ThreadId;
  readonly visible: boolean;
  readonly onClose: () => void;
}) {
  const state = useThreadStore((store) => store.diffs[threadId]);
  const loadLatestTurnDiff = useThreadStore((store) => store.loadLatestTurnDiff);

  useEffect(() => {
    // Refetch on every open: a turn that finished while the sheet was closed
    // would otherwise show a stale diff.
    if (visible) void loadLatestTurnDiff(threadId);
  }, [visible, threadId, loadLatestTurnDiff]);

  const t = useThreadTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  const sections = useMemo(() => parseUnifiedDiff(state?.diff ?? ""), [state?.diff]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Text style={styles.title}>Changes</Text>
          {state?.toTurnCount != null ? (
            <Text style={styles.range}>
              turn {state.fromTurnCount}→{state.toTurnCount}
            </Text>
          ) : null}
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={22} color={t.colors.muted} />
          </Pressable>
        </View>

        {state?.status === "loading" ? (
          <View style={styles.centered}>
            <ActivityIndicator color={t.colors.muted} />
          </View>
        ) : state?.status === "error" ? (
          <View style={styles.centered}>
            <Ionicons name="alert-circle-outline" size={28} color={t.colors.danger} />
            <Text style={styles.errorText}>{state.error}</Text>
            <Pressable onPress={() => void loadLatestTurnDiff(threadId)} style={styles.retry}>
              <Text style={styles.retryLabel}>Retry</Text>
            </Pressable>
          </View>
        ) : sections.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.emptyText}>No file changes in the latest turn.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body}>
            {sections.map((section) => (
              <View key={section.path} style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionPath} numberOfLines={1} ellipsizeMode="head">
                    {section.path}
                  </Text>
                  <Text style={styles.sectionCounts}>
                    <Text style={styles.addCount}>+{section.additions}</Text>{" "}
                    <Text style={styles.removeCount}>−{section.deletions}</Text>
                  </Text>
                </View>
                {/* Diff lines must not wrap; a horizontal scroller preserves
                    alignment the way a terminal pager would. */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View>
                    {section.lines.map((line, index) => (
                      <Text key={index} style={[styles.line, styles[LINE_STYLE_KEY[line.kind]]]}>
                        {line.text.length === 0 ? " " : line.text}
                      </Text>
                    ))}
                  </View>
                </ScrollView>
              </View>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function makeStyles(t: ThreadTokens) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.colors.border,
    },
    title: { color: t.colors.text, fontSize: fontSize.title, fontWeight: "700" },
    range: { color: t.colors.muted, fontSize: fontSize.caption, marginRight: "auto" },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      padding: spacing.lg,
    },
    errorText: { color: t.colors.danger, fontSize: fontSize.small, textAlign: "center" },
    emptyText: { color: t.colors.muted, fontSize: fontSize.small },
    retry: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    retryLabel: { color: t.colors.text, fontSize: fontSize.small },
    body: { padding: spacing.md, gap: spacing.md },
    section: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
      borderRadius: radius.md,
      overflow: "hidden",
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      backgroundColor: t.colors.surface,
    },
    sectionPath: {
      flex: 1,
      color: t.colors.text,
      fontSize: fontSize.caption,
      fontFamily: MONO_FONT,
    },
    sectionCounts: { fontSize: fontSize.caption },
    addCount: { color: t.threadColors.diffAdd },
    removeCount: { color: t.threadColors.diffRemove },
    line: {
      fontFamily: MONO_FONT,
      fontSize: 11,
      lineHeight: 16,
      paddingHorizontal: spacing.sm,
    },
    lineAdd: { color: t.threadColors.diffAdd, backgroundColor: t.threadColors.diffAddBackground },
    lineRemove: {
      color: t.threadColors.diffRemove,
      backgroundColor: t.threadColors.diffRemoveBackground,
    },
    lineHunk: { color: t.threadColors.diffHunk },
    lineMeta: { color: t.colors.muted },
    lineContext: { color: t.colors.text },
  });
}

/** Per-line tone, resolved through the style sheet so it follows the theme. */
const LINE_STYLE_KEY = {
  add: "lineAdd",
  remove: "lineRemove",
  hunk: "lineHunk",
  meta: "lineMeta",
  context: "lineContext",
} as const satisfies Record<DiffLine["kind"], string>;
