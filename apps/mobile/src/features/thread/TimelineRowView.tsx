// FILE: TimelineRowView.tsx
// Purpose: Render one derived timeline row.
// Layer: Mobile thread UI
// Exports: TimelineRowView.
//
// One component per row kind, all self-contained, so merging this feature into
// the app shell is a file move. Row *derivation* lives in
// src/features/thread/logic/timeline.ts and is unit tested there.

import { memo, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import type { TimelineRow } from "@/features/thread/logic/timeline";
import type { ToolEntry, ToolStatus } from "@/features/thread/logic/toolCall";
import { Markdown } from "./Markdown";
import {
  fontSize,
  MONO_FONT,
  radius,
  spacing,
  useThreadTokens,
  type ThreadTokens,
} from "./threadTheme";

/** Long-press anywhere on a message copies its text — there is no right-click on a phone. */
function useCopyOnLongPress(text: string): {
  readonly onLongPress: () => void;
  readonly copied: boolean;
} {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    onLongPress: () => {
      void Clipboard.setStringAsync(text);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    },
  };
}

function CopiedBadge({ visible }: { readonly visible: boolean }) {
  const t = useThreadTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  if (!visible) return null;
  return (
    <View style={styles.copiedBadge}>
      <Ionicons name="checkmark" size={11} color={t.threadColors.onAttention} />
      <Text style={styles.copiedText}>Copied</Text>
    </View>
  );
}

function UserMessage({ text }: { readonly text: string }) {
  const t = useThreadTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  const { onLongPress, copied } = useCopyOnLongPress(text);
  return (
    <Pressable onLongPress={onLongPress} delayLongPress={350} style={styles.userRow}>
      <View style={styles.userBubble}>
        <Text style={styles.userText} selectable>
          {text}
        </Text>
        <CopiedBadge visible={copied} />
      </View>
    </Pressable>
  );
}

function AssistantMessage({
  text,
  streaming,
}: {
  readonly text: string;
  readonly streaming: boolean;
}) {
  const t = useThreadTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  const { onLongPress, copied } = useCopyOnLongPress(text);
  return (
    <Pressable onLongPress={onLongPress} delayLongPress={350} style={styles.assistantRow}>
      <Markdown text={text} />
      {streaming ? <View style={styles.caret} /> : null}
      <CopiedBadge visible={copied} />
    </Pressable>
  );
}

function toolStatusIcon(
  t: ThreadTokens,
  status: ToolStatus,
): { readonly name: "ellipse-outline" | "checkmark" | "close" | "remove"; readonly color: string } {
  switch (status) {
    case "running":
      return { name: "ellipse-outline", color: t.threadColors.running };
    case "completed":
      return { name: "checkmark", color: t.colors.muted };
    case "failed":
      return { name: "close", color: t.colors.danger };
    case "cancelled":
      return { name: "remove", color: t.colors.muted };
  }
}

function ToolLine({ entry }: { readonly entry: ToolEntry }) {
  const t = useThreadTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  const icon = toolStatusIcon(t, entry.status);
  return (
    <View style={styles.toolLine}>
      <Ionicons name={icon.name} size={12} color={icon.color} style={styles.toolIcon} />
      <View style={styles.toolLineBody}>
        <Text style={styles.toolLabel} numberOfLines={2}>
          {entry.label}
        </Text>
        {entry.detail !== null && entry.detail !== entry.label ? (
          <Text style={styles.toolDetail} numberOfLines={3}>
            {entry.detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function ToolGroup({ row }: { readonly row: Extract<TimelineRow, { kind: "tool-group" }> }) {
  const t = useThreadTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  // An un-summarizable run (one entry) has nothing to collapse, so it starts open.
  const [expanded, setExpanded] = useState(row.summary === null);
  if (row.summary === null || expanded) {
    return (
      <View style={styles.toolGroup}>
        {row.summary !== null ? (
          <Pressable onPress={() => setExpanded(false)} style={styles.toolSummaryRow} hitSlop={6}>
            <Ionicons name="chevron-down" size={12} color={t.colors.muted} />
            <Text style={styles.toolSummaryLabel}>{row.summary.label}</Text>
          </Pressable>
        ) : null}
        {row.entries.map((entry) => (
          <ToolLine key={entry.id} entry={entry} />
        ))}
      </View>
    );
  }
  return (
    <Pressable onPress={() => setExpanded(true)} style={styles.toolGroup} hitSlop={6}>
      <View style={styles.toolSummaryRow}>
        <Ionicons name="chevron-forward" size={12} color={t.colors.muted} />
        <Text style={styles.toolSummaryLabel} numberOfLines={2}>
          {row.summary.label}
        </Text>
        {row.summary.hasRunningEntry ? (
          <Ionicons name="ellipse-outline" size={11} color={t.threadColors.running} />
        ) : null}
        {row.summary.hasFailedEntry ? (
          <Ionicons name="close" size={12} color={t.colors.danger} />
        ) : null}
      </View>
    </Pressable>
  );
}

function ActivityLine({
  summary,
  tone,
}: {
  readonly summary: string;
  readonly tone: "muted" | "error";
}) {
  const t = useThreadTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  return (
    <View style={styles.activityRow}>
      <Text style={tone === "error" ? styles.errorText : styles.activityText} numberOfLines={6}>
        {summary}
      </Text>
    </View>
  );
}

function ProposedPlan({ row }: { readonly row: Extract<TimelineRow, { kind: "proposed-plan" }> }) {
  const t = useThreadTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.planCard}>
      <Pressable
        onPress={() => setExpanded((value) => !value)}
        style={styles.planHeader}
        hitSlop={6}
      >
        <Ionicons name="map-outline" size={14} color={t.threadColors.attention} />
        <Text style={styles.planTitle}>Proposed plan</Text>
        {row.plan.implementedAt !== null ? <Text style={styles.planBadge}>implemented</Text> : null}
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={14}
          color={t.colors.muted}
          style={styles.planChevron}
        />
      </Pressable>
      {expanded ? (
        <Markdown text={row.plan.planMarkdown} />
      ) : (
        <Text style={styles.planPreview} numberOfLines={3}>
          {row.plan.planMarkdown}
        </Text>
      )}
    </View>
  );
}

function Checkpoint({ row }: { readonly row: Extract<TimelineRow, { kind: "checkpoint" }> }) {
  const t = useThreadTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  const additions = row.checkpoint.files.reduce((total, file) => total + file.additions, 0);
  const deletions = row.checkpoint.files.reduce((total, file) => total + file.deletions, 0);
  return (
    <View style={styles.checkpointRow}>
      <View style={styles.checkpointRule} />
      <Text style={styles.checkpointText}>
        {row.checkpoint.files.length} {row.checkpoint.files.length === 1 ? "file" : "files"}
        {"  "}
        <Text style={styles.diffAdd}>+{additions}</Text>{" "}
        <Text style={styles.diffRemove}>−{deletions}</Text>
      </Text>
      <View style={styles.checkpointRule} />
    </View>
  );
}

export const TimelineRowView = memo(function TimelineRowView({
  row,
}: {
  readonly row: TimelineRow;
}) {
  switch (row.kind) {
    case "user-message":
      return <UserMessage text={row.message.text} />;
    case "assistant-message":
      return <AssistantMessage text={row.message.text} streaming={row.message.streaming} />;
    case "tool-group":
      return <ToolGroup row={row} />;
    case "activity":
      return <ActivityLine summary={row.activity.summary} tone="muted" />;
    case "error":
      return <ActivityLine summary={row.activity.summary} tone="error" />;
    case "proposed-plan":
      return <ProposedPlan row={row} />;
    case "checkpoint":
      return <Checkpoint row={row} />;
  }
});

function makeStyles(t: ThreadTokens) {
  return StyleSheet.create({
    userRow: { alignItems: "flex-end" },
    userBubble: {
      maxWidth: "88%",
      backgroundColor: t.threadColors.userBubble,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
      borderRadius: radius.lg,
      borderBottomRightRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    userText: { color: t.colors.text, fontSize: fontSize.body, lineHeight: 21 },
    assistantRow: { paddingRight: spacing.sm },
    caret: {
      width: 7,
      height: 15,
      backgroundColor: t.threadColors.attention,
      marginTop: spacing.xs,
      borderRadius: 1,
    },
    copiedBadge: {
      position: "absolute",
      top: -6,
      right: 6,
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      backgroundColor: t.threadColors.attention,
      borderRadius: radius.pill,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    copiedText: { color: t.threadColors.onAttention, fontSize: fontSize.micro, fontWeight: "700" },
    toolGroup: {
      backgroundColor: t.threadColors.sunken,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      gap: spacing.xs,
    },
    toolSummaryRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    toolSummaryLabel: { flex: 1, color: t.colors.muted, fontSize: fontSize.small },
    toolLine: { flexDirection: "row", gap: spacing.xs, alignItems: "flex-start" },
    toolIcon: { marginTop: 3 },
    toolLineBody: { flex: 1 },
    toolLabel: { color: t.colors.text, fontSize: fontSize.small },
    toolDetail: {
      color: t.colors.muted,
      fontSize: fontSize.caption,
      fontFamily: MONO_FONT,
      marginTop: 1,
    },
    activityRow: { paddingVertical: 1 },
    activityText: { color: t.colors.muted, fontSize: fontSize.caption },
    errorText: { color: t.colors.danger, fontSize: fontSize.small },
    planCard: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.threadColors.attention,
      borderRadius: radius.md,
      backgroundColor: t.colors.surface,
      padding: spacing.sm,
      gap: spacing.xs,
    },
    planHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    planTitle: { color: t.colors.text, fontSize: fontSize.small, fontWeight: "700" },
    planBadge: {
      color: t.colors.muted,
      fontSize: fontSize.micro,
      textTransform: "uppercase",
      letterSpacing: 1,
    },
    planChevron: { marginLeft: "auto" },
    planPreview: { color: t.colors.muted, fontSize: fontSize.small },
    checkpointRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: 2,
    },
    checkpointRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: t.colors.border },
    checkpointText: { color: t.colors.muted, fontSize: fontSize.caption },
    diffAdd: { color: t.threadColors.diffAdd },
    diffRemove: { color: t.threadColors.diffRemove },
  });
}
