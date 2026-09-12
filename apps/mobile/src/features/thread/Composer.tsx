// FILE: Composer.tsx
// Purpose: Bottom-anchored multiline input with Send / Stop.
// Layer: Mobile thread UI
// Exports: Composer.
//
// The draft lives in threadStore (per thread, for the life of the process) so
// navigating away and back does not lose typing. `blurOnSubmit={false}` plus a
// multiline input means Return inserts a newline — sending is the button only,
// which is the right trade on a phone where Return is the obvious newline key.

import { useMemo } from "react";
import { StyleSheet, Text, TextInput, Pressable, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import type { ThreadId } from "@synara/contracts";

import { useThreadStore } from "@/state/threadStore";
import { fontSize, radius, spacing, useThreadTokens, type ThreadTokens } from "./threadTheme";

export function Composer({
  threadId,
  turnRunning,
  connected,
}: {
  readonly threadId: ThreadId;
  readonly turnRunning: boolean;
  readonly connected: boolean;
}) {
  const draft = useThreadStore((state) => state.drafts[threadId] ?? "");
  const sending = useThreadStore((state) => state.sending[threadId] === true);
  const setDraft = useThreadStore((state) => state.setDraft);
  const sendMessage = useThreadStore((state) => state.sendMessage);
  const interruptTurn = useThreadStore((state) => state.interruptTurn);
  const t = useThreadTokens();
  const styles = useMemo(() => makeStyles(t), [t]);

  const canSend = connected && draft.trim().length > 0 && !sending;

  const onSend = (): void => {
    if (!canSend) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void sendMessage(threadId, draft);
  };

  const onStop = (): void => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    void interruptTurn(threadId);
  };

  return (
    <View style={styles.root}>
      {/* Sending into a running turn is allowed: the server queues it and emits
          `thread.turn-queued`. The hint sets the expectation that the reply
          lands after the current turn rather than interrupting it. */}
      {turnRunning && draft.trim().length > 0 ? (
        <Text style={styles.queuedHint}>will be sent after this turn</Text>
      ) : null}
      <View style={styles.bar}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={(value) => setDraft(threadId, value)}
          placeholder={connected ? "Message" : "Disconnected"}
          placeholderTextColor={t.colors.muted}
          multiline
          blurOnSubmit={false}
          editable={connected}
          accessibilityLabel="Message"
        />
        {/* Stop and Send coexist while a turn runs. Replacing Send with Stop
            would make the queued-message hint a lie: there would be no way to
            queue anything. Stop is the extra affordance, not a mode. */}
        {turnRunning ? (
          <Pressable
            onPress={onStop}
            style={({ pressed }) => [
              styles.button,
              styles.stopButton,
              pressed ? styles.pressed : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Stop the running turn"
          >
            <Ionicons name="square" size={15} color={t.colors.background} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={onSend}
          disabled={!canSend}
          style={({ pressed }) => [
            styles.button,
            canSend ? styles.sendButton : styles.buttonDisabled,
            pressed && canSend ? styles.pressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel={turnRunning ? "Send after the current turn" : "Send"}
          accessibilityState={{ disabled: !canSend }}
        >
          <Ionicons
            name="arrow-up"
            size={18}
            color={canSend ? t.threadColors.onAttention : t.colors.muted}
          />
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(t: ThreadTokens) {
  return StyleSheet.create({
    root: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.colors.border,
      backgroundColor: t.colors.background,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    queuedHint: {
      color: t.colors.muted,
      fontSize: fontSize.micro,
      paddingBottom: spacing.xs,
      paddingLeft: spacing.xs,
    },
    bar: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
    input: {
      flex: 1,
      minHeight: 40,
      // Roughly six lines; beyond that the input scrolls instead of eating the list.
      maxHeight: 140,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
      borderRadius: radius.lg,
      backgroundColor: t.colors.surface,
      color: t.colors.text,
      fontSize: fontSize.body,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
    },
    button: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    sendButton: { backgroundColor: t.threadColors.attention },
    stopButton: { backgroundColor: t.colors.danger },
    buttonDisabled: {
      backgroundColor: t.colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
    },
    pressed: { opacity: 0.7 },
  });
}
