// FILE: [id].tsx
// Purpose: The thread screen — transcript, pending prompts, composer, diff sheet.
// Layer: Mobile screens
//
// Thin by design: every piece of state comes from `threadStore` (subscription
// lifecycle, drafts, sending) and every derivation from
// `src/features/thread/logic/*` (pure and unit tested). This file only wires
// them together and owns the keyboard/safe-area layout.

import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import type { ThreadId } from "@synara/contracts";

import { Composer } from "@/features/thread/Composer";
import { DiffSheet } from "@/features/thread/DiffSheet";
import { PendingInteractionCards } from "@/features/thread/PendingInteractionCards";
import { ThreadHeader } from "@/features/thread/ThreadHeader";
import { ThreadTimeline } from "@/features/thread/ThreadTimeline";
import {
  fontSize,
  radius,
  spacing,
  useThreadTokens,
  type ThreadTokens,
} from "@/features/thread/threadTheme";
import { deriveTimelineRows } from "@/features/thread/logic/timeline";
import { isTurnRunning, latestTurnDiffRange } from "@/features/thread/logic/threadStatus";
// The header pill and the list row must never disagree about the same thread,
// so both read the shell's deriver — the single port of the web rules.
import { deriveThreadStatus } from "@/features/shell/threadStatus";
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
  const t = useThreadTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();

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
    hasPendingApprovals: pending.approvals.length > 0,
    hasPendingUserInput: pending.userInputs.length > 0,
  });
  const turnRunning = isTurnRunning(detail.session, detail.latestTurn);
  const connected = connection.status === "connected";

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      {/* The native header is suppressed for this route in _layout.tsx rather
          than here: a route-level `<Stack.Screen>` is applied after the first
          paint, so declaring it here flashed the native "Thread" bar on every
          push. This screen renders its own header (status pill, branch,
          Changes) instead. Also why `keyboardVerticalOffset` is 0: there is no
          native header above the KeyboardAvoidingView to clear. */}
      <ThreadHeader
        title={detail.title ?? threadId}
        branch={detail.branch}
        status={status}
        disconnected={!connected}
        // A notification or deep link can mount this route with no history, in
        // which case `back()` is a no-op and the screen becomes a dead end.
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
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
            <Ionicons name="alert-circle-outline" size={15} color={t.colors.danger} />
            <Text style={styles.toastText} numberOfLines={3}>
              {error}
            </Text>
            <Ionicons name="close" size={15} color={t.colors.muted} />
          </Pressable>
        ) : null}

        <PendingInteractionCards
          threadId={threadId}
          approvals={pending.approvals}
          userInputs={pending.userInputs}
        />

        {/* Not a `SafeAreaView`: that applies the home-indicator inset no
            matter where it sits, so with the keyboard up it would stack 34pt of
            dead space on top of the padding `KeyboardAvoidingView` already
            added. The inset is only real while the keyboard is down. */}
        <View
          style={[styles.composerSafeArea, { paddingBottom: keyboardVisible ? 0 : insets.bottom }]}
        >
          <Composer threadId={threadId} turnRunning={turnRunning} connected={connected} />
        </View>
      </KeyboardAvoidingView>

      <DiffSheet threadId={threadId} visible={diffOpen} onClose={() => setDiffOpen(false)} />
    </SafeAreaView>
  );
}

/** True while the software keyboard is on screen. */
function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // The `Will` events fire with the animation rather than after it, so the
    // inset disappears in the same frame the keyboard starts covering it.
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setVisible(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

function makeStyles(t: ThreadTokens) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.colors.background },
    body: { flex: 1 },
    composerSafeArea: { backgroundColor: t.colors.background },
    toast: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginHorizontal: spacing.md,
      marginBottom: spacing.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.danger,
      borderRadius: radius.md,
      backgroundColor: t.colors.surface,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
    },
    toastText: { flex: 1, color: t.colors.text, fontSize: fontSize.caption },
  });
}
