// FILE: [id].tsx
// Purpose: The thread screen — transcript, pending prompts, composer, diff sheet.
// Layer: Mobile screens
//
// Thin by design: every piece of state comes from `threadStore` (subscription
// lifecycle, drafts, sending) and every derivation from
// `src/features/thread/logic/*` (pure and unit tested). This file only wires
// them together and owns the keyboard/safe-area layout.

import { useEffect, useMemo, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import type { ThreadId } from "@synara/contracts";

import { Composer } from "@/features/thread/Composer";
import { DiffSheet } from "@/features/thread/DiffSheet";
import { PendingInteractionCards } from "@/features/thread/PendingInteractionCards";
import { ThreadHeader } from "@/features/thread/ThreadHeader";
import { ThreadTimeline } from "@/features/thread/ThreadTimeline";
import { colors, fontSize, radius, spacing } from "@/features/thread/threadTheme";
import { deriveTimelineRows } from "@/features/thread/logic/timeline";
import {
  deriveThreadStatus,
  isTurnRunning,
  latestTurnDiffRange,
} from "@/features/thread/logic/threadStatus";
import { threadDetailPending } from "@/state/threadProjection";
import { useSynaraStore } from "@/state/synaraStore";
import { useThreadDetail, useThreadStore } from "@/state/threadStore";

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const threadId = (id ?? "") as ThreadId;

  const connection = useSynaraStore((state) => state.connection);
  const detail = useThreadDetail(threadId);
  const retainThread = useThreadStore((state) => state.retainThread);
  const error = useThreadStore((state) => state.errors[threadId]);
  const dismissError = useThreadStore((state) => state.dismissError);
  const [diffOpen, setDiffOpen] = useState(false);

  useEffect(() => {
    if (threadId.length === 0) return;
    // Retained, not owned: the store keeps the stream open for a retention
    // window so navigating back and forth does not re-snapshot.
    return retainThread(threadId);
  }, [threadId, retainThread]);

  // The reducer replaces the whole detail on a re-snapshot, so this recomputes
  // only when something actually changed.
  const rows = useMemo(
    () =>
      deriveTimelineRows({
        messages: detail.messages,
        activities: detail.activities,
        proposedPlans: detail.proposedPlans,
        checkpoints: detail.checkpoints,
      }),
    [detail.messages, detail.activities, detail.proposedPlans, detail.checkpoints],
  );

  // The orphaned-claim policy needs a wall-clock reference. Recomputing it with
  // the activity list (rather than on a timer) is enough: a claim only becomes
  // reclaimable alongside new thread traffic.
  const pending = useMemo(() => threadDetailPending(detail, new Date().toISOString()), [detail]);

  const status = deriveThreadStatus({
    session: detail.session,
    latestTurn: detail.latestTurn,
    pendingCount: pending.approvals.length + pending.userInputs.length,
  });
  const turnRunning = isTurnRunning(detail.session, detail.latestTurn);
  const connected = connection.status === "connected";

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      {/* The root layout declares a native header for this route. This screen
          renders its own (status pill, branch, Changes), so the native one is
          suppressed here rather than in _layout.tsx — that file belongs to the
          shell, and a route is entitled to override its own options. Also why
          `keyboardVerticalOffset` is 0: there is no native header to clear. */}
      <Stack.Screen options={{ headerShown: false }} />
      <ThreadHeader
        title={detail.title ?? threadId}
        branch={detail.branch}
        status={status}
        disconnected={!connected}
        // A notification or deep link can mount this route with no history, in
        // which case `back()` is a no-op and the screen becomes a dead end.
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/threads"))}
        onOpenChanges={() => setDiffOpen(true)}
        changesEnabled={connected && latestTurnDiffRange(detail.checkpoints) !== null}
      />

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        // No native header above this view, so nothing to offset past.
        keyboardVerticalOffset={0}
      >
        <ThreadTimeline
          rows={rows}
          emptyLabel={detail.hasSnapshot ? "No messages in this thread yet." : "Loading thread…"}
        />

        {error !== undefined ? (
          <Pressable style={styles.toast} onPress={() => dismissError(threadId)}>
            <Ionicons name="alert-circle-outline" size={15} color={colors.danger} />
            <Text style={styles.toastText} numberOfLines={3}>
              {error}
            </Text>
            <Ionicons name="close" size={15} color={colors.muted} />
          </Pressable>
        ) : null}

        <PendingInteractionCards
          threadId={threadId}
          approvals={pending.approvals}
          userInputs={pending.userInputs}
        />

        <SafeAreaView edges={["bottom"]} style={styles.composerSafeArea}>
          <Composer threadId={threadId} turnRunning={turnRunning} connected={connected} />
        </SafeAreaView>
      </KeyboardAvoidingView>

      <DiffSheet threadId={threadId} visible={diffOpen} onClose={() => setDiffOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
  composerSafeArea: { backgroundColor: colors.background },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  toastText: { flex: 1, color: colors.text, fontSize: fontSize.caption },
});
