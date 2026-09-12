// FILE: PendingInteractionCards.tsx
// Purpose: Approval and user-input prompts, pinned directly above the composer.
// Layer: Mobile thread UI
// Exports: PendingInteractionCards.
//
// Mirrors apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx and
// ComposerPendingUserInputPanel.tsx: the same decision vocabulary and the same
// "one card at a time, with an n-of-m counter" rule, restyled for touch.
//
// Only the oldest prompt is shown. Concurrent prompts are rare, and stacking
// full-width cards over a phone composer buries the input entirely.

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
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import type { ProviderApprovalDecision, ThreadId } from "@synara/contracts";

import {
  parseApprovalDetail,
  pendingRequestInstanceKey,
  type ApprovalRequestKind,
  type PendingApproval,
  type PendingUserInput,
} from "@/features/thread/logic/pendingInteractions";
import { useThreadStore } from "@/state/threadStore";
import { colors, fontSize, MONO_FONT, radius, spacing, threadColors } from "./threadTheme";

const KIND_PROMPT: Record<ApprovalRequestKind, string> = {
  command: "Run this command?",
  "file-read": "Read this file?",
  "file-change": "Apply this change?",
  permissions: "Grant these permissions?",
};

const KIND_ICON: Record<
  ApprovalRequestKind,
  "terminal-outline" | "document-text-outline" | "create-outline" | "key-outline"
> = {
  command: "terminal-outline",
  "file-read": "document-text-outline",
  "file-change": "create-outline",
  permissions: "key-outline",
};

interface ActionSpec {
  readonly decision: ProviderApprovalDecision;
  readonly label: string;
  readonly tone: "primary" | "neutral" | "destructive";
}

const APPROVAL_ACTIONS: readonly ActionSpec[] = [
  { decision: "accept", label: "Allow", tone: "primary" },
  { decision: "acceptForSession", label: "Allow for session", tone: "neutral" },
  { decision: "decline", label: "Deny", tone: "destructive" },
  { decision: "cancel", label: "Cancel turn", tone: "neutral" },
];

function CardFrame({
  children,
  count,
  index,
}: {
  readonly children: React.ReactNode;
  readonly count: number;
  readonly index: number;
}) {
  return (
    <View style={styles.card}>
      {count > 1 ? (
        <Text style={styles.counter}>
          {index + 1}/{count}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

function ActionButton({
  spec,
  disabled,
  onPress,
}: {
  readonly spec: ActionSpec;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={spec.label}
      style={({ pressed }) => [
        styles.action,
        spec.tone === "primary" ? styles.actionPrimary : null,
        spec.tone === "destructive" ? styles.actionDestructive : null,
        disabled ? styles.actionDisabled : null,
        pressed ? styles.actionPressed : null,
      ]}
    >
      <Text
        style={[
          styles.actionLabel,
          spec.tone === "primary" ? styles.actionLabelPrimary : null,
          spec.tone === "destructive" ? styles.actionLabelDestructive : null,
        ]}
      >
        {spec.label}
      </Text>
    </Pressable>
  );
}

function ApprovalCard({
  threadId,
  approval,
  count,
}: {
  readonly threadId: ThreadId;
  readonly approval: PendingApproval;
  readonly count: number;
}) {
  const respondToApproval = useThreadStore((state) => state.respondToApproval);
  const responding = useThreadStore((state) => state.responding[approval.requestId] === true);
  const parsed = parseApprovalDetail(approval.detail);

  // One-shot guard keyed on the request *instance* plus its retry attempt, so a
  // double tap cannot double-answer but a server-side retryable failure re-arms
  // the card. Mirrors ComposerPendingApprovalPanel's submittedRequestKeyRef.
  //
  // This ref — not `responding` — is what prevents a double submit. `responding`
  // is in-flight only (see threadStore.respondToApproval); between the dispatch
  // resolving and the server echo the buttons come back, and the ref holds the
  // line until the durable state either resolves the prompt or hands out a new
  // `responseAttemptKey`.
  const submissionKey = `${pendingRequestInstanceKey(approval.requestId, approval.lifecycleGeneration)}|${approval.responseAttemptKey ?? ""}`;
  const submittedRef = useRef<string | null>(null);
  // The ref is the guard (it wins races within a single frame, which state
  // cannot); this mirrors it purely so the card can *look* answered. Without it
  // the buttons render enabled during the gap between the dispatch resolving and
  // the server echo, while the ref silently swallows taps.
  const [submittedKey, setSubmittedKey] = useState<string | null>(null);
  useEffect(() => {
    if (submittedRef.current !== null && submittedRef.current !== submissionKey) {
      submittedRef.current = null;
    }
    setSubmittedKey((current) => (current === submissionKey ? current : null));
  }, [submissionKey]);
  const busy = responding || submittedKey === submissionKey;

  const actions =
    approval.sessionApprovalAvailable === false
      ? APPROVAL_ACTIONS.filter((action) => action.decision !== "acceptForSession")
      : APPROVAL_ACTIONS;

  const respond = (decision: ProviderApprovalDecision): void => {
    if (busy || submittedRef.current === submissionKey) return;
    submittedRef.current = submissionKey;
    setSubmittedKey(submissionKey);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void respondToApproval({
      threadId,
      requestId: approval.requestId,
      lifecycleGeneration: approval.lifecycleGeneration,
      decision,
    }).then((ok) => {
      // A rejected dispatch is still retryable; release the claim.
      if (ok || submittedRef.current !== submissionKey) return;
      submittedRef.current = null;
      setSubmittedKey(null);
    });
  };

  const body = parsed.command ?? parsed.filePath ?? parsed.fallback;
  return (
    <CardFrame count={count} index={0}>
      <View style={styles.cardHeader}>
        <Ionicons name={KIND_ICON[approval.requestKind]} size={15} color={threadColors.attention} />
        <Text style={styles.cardTitle}>{KIND_PROMPT[approval.requestKind]}</Text>
        {parsed.tool !== null ? <Text style={styles.cardTool}>{parsed.tool}</Text> : null}
      </View>
      {body !== null ? (
        <ScrollView
          horizontal={parsed.command !== null}
          showsHorizontalScrollIndicator={false}
          style={styles.detailBox}
          contentContainerStyle={styles.detailContent}
        >
          <Text style={styles.detailText} selectable>
            {body}
          </Text>
        </ScrollView>
      ) : null}
      {busy ? (
        <View style={styles.respondingRow}>
          <ActivityIndicator size="small" color={colors.muted} />
          <Text style={styles.respondingText}>responding…</Text>
        </View>
      ) : (
        <View style={styles.actionRow}>
          {actions.map((spec) => (
            <ActionButton
              key={spec.decision}
              spec={spec}
              disabled={false}
              onPress={() => respond(spec.decision)}
            />
          ))}
        </View>
      )}
    </CardFrame>
  );
}

function UserInputCard({
  threadId,
  userInput,
  count,
}: {
  readonly threadId: ThreadId;
  readonly userInput: PendingUserInput;
  readonly count: number;
}) {
  const respondToUserInput = useThreadStore((state) => state.respondToUserInput);
  const responding = useThreadStore((state) => state.responding[userInput.requestId] === true);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});

  // Same one-shot guard as ApprovalCard, for the same reason: `responding` only
  // covers the dispatch itself, so the ref is what makes submission idempotent
  // until the durable settlement says another attempt is allowed.
  const submissionKey = `${pendingRequestInstanceKey(userInput.requestId, userInput.lifecycleGeneration)}|${userInput.responseAttemptKey ?? ""}`;
  const submittedRef = useRef<string | null>(null);
  const [submittedKey, setSubmittedKey] = useState<string | null>(null);
  useEffect(() => {
    if (submittedRef.current !== null && submittedRef.current !== submissionKey) {
      submittedRef.current = null;
    }
    setSubmittedKey((current) => (current === submissionKey ? current : null));
  }, [submissionKey]);
  const busy = responding || submittedKey === submissionKey;

  const toggle = (questionId: string, label: string, multiSelect: boolean): void => {
    void Haptics.selectionAsync();
    setAnswers((current) => {
      const selected = current[questionId] ?? [];
      if (!multiSelect) return { ...current, [questionId]: [label] };
      return {
        ...current,
        [questionId]: selected.includes(label)
          ? selected.filter((entry) => entry !== label)
          : [...selected, label],
      };
    });
  };

  const setFreeText = (questionId: string, value: string): void => {
    setAnswers((current) => ({ ...current, [questionId]: value.length === 0 ? [] : [value] }));
  };

  const answered = userInput.questions.every((question) => (answers[question.id] ?? []).length > 0);

  const submit = (): void => {
    if (busy || !answered || submittedRef.current === submissionKey) return;
    submittedRef.current = submissionKey;
    setSubmittedKey(submissionKey);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const payload: Record<string, string | string[]> = {};
    for (const question of userInput.questions) {
      const selected = answers[question.id] ?? [];
      if (selected.length === 0) continue;
      // Single-select questions answer with a bare string; the provider treats
      // an array of one differently for some prompt kinds.
      payload[question.id] = question.multiSelect === true ? selected : (selected[0] ?? "");
    }
    void respondToUserInput({
      threadId,
      requestId: userInput.requestId,
      lifecycleGeneration: userInput.lifecycleGeneration,
      answers: payload,
    }).then((ok) => {
      // A rejected dispatch is still retryable; release the claim.
      if (ok || submittedRef.current !== submissionKey) return;
      submittedRef.current = null;
      setSubmittedKey(null);
    });
  };

  return (
    <CardFrame count={count} index={0}>
      <View style={styles.cardHeader}>
        <Ionicons name="help-circle-outline" size={15} color={threadColors.attention} />
        <Text style={styles.cardTitle}>Agent needs an answer</Text>
      </View>
      <ScrollView style={styles.questionScroll} keyboardShouldPersistTaps="handled">
        {userInput.questions.map((question) => (
          <View key={question.id} style={styles.question}>
            <Text style={styles.questionHeader}>{question.header}</Text>
            <Text style={styles.questionText}>{question.question}</Text>
            {question.options.length > 0 ? (
              <View style={styles.chipRow}>
                {question.options.map((option) => {
                  const selected = (answers[question.id] ?? []).includes(option.label);
                  return (
                    <Pressable
                      key={option.label}
                      onPress={() =>
                        toggle(question.id, option.label, question.multiSelect === true)
                      }
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={[styles.chip, selected ? styles.chipSelected : null]}
                    >
                      <Text style={[styles.chipLabel, selected ? styles.chipLabelSelected : null]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              // A question with no options is free-form.
              <TextInput
                style={styles.freeText}
                placeholder="Type an answer"
                placeholderTextColor={colors.muted}
                value={answers[question.id]?.[0] ?? ""}
                onChangeText={(value) => setFreeText(question.id, value)}
                editable={!busy}
                multiline
              />
            )}
          </View>
        ))}
      </ScrollView>
      {busy ? (
        <View style={styles.respondingRow}>
          <ActivityIndicator size="small" color={colors.muted} />
          <Text style={styles.respondingText}>responding…</Text>
        </View>
      ) : (
        <View style={styles.actionRow}>
          <ActionButton
            spec={{ decision: "accept", label: "Submit", tone: "primary" }}
            disabled={!answered}
            onPress={submit}
          />
        </View>
      )}
    </CardFrame>
  );
}

export function PendingInteractionCards({
  threadId,
  approvals,
  userInputs,
}: {
  readonly threadId: ThreadId;
  readonly approvals: readonly PendingApproval[];
  readonly userInputs: readonly PendingUserInput[];
}) {
  // Approvals block the turn hardest, so they take the slot when both exist.
  const approval = approvals[0];
  if (approval !== undefined) {
    return <ApprovalCard threadId={threadId} approval={approval} count={approvals.length} />;
  }
  const userInput = userInputs[0];
  if (userInput !== undefined) {
    return <UserInputCard threadId={threadId} userInput={userInput} count={userInputs.length} />;
  }
  return null;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: threadColors.attention,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  counter: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    color: colors.muted,
    fontSize: fontSize.micro,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  cardTitle: { color: colors.text, fontSize: fontSize.small, fontWeight: "700" },
  cardTool: { color: colors.muted, fontSize: fontSize.caption },
  detailBox: {
    maxHeight: 96,
    backgroundColor: threadColors.codeBackground,
    borderRadius: radius.sm,
  },
  detailContent: { padding: spacing.sm },
  detailText: { color: colors.text, fontFamily: MONO_FONT, fontSize: fontSize.small },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  action: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionPrimary: { backgroundColor: threadColors.attention, borderColor: threadColors.attention },
  actionDestructive: { borderColor: colors.danger },
  actionDisabled: { opacity: 0.4 },
  actionPressed: { opacity: 0.7 },
  actionLabel: { color: colors.text, fontSize: fontSize.small, fontWeight: "600" },
  actionLabelPrimary: { color: colors.background },
  actionLabelDestructive: { color: colors.danger },
  respondingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  respondingText: { color: colors.muted, fontSize: fontSize.small },
  questionScroll: { maxHeight: 220 },
  question: { gap: spacing.xs, marginBottom: spacing.sm },
  questionHeader: {
    color: colors.muted,
    fontSize: fontSize.micro,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  questionText: { color: colors.text, fontSize: fontSize.small },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  chipSelected: { backgroundColor: threadColors.attention, borderColor: threadColors.attention },
  chipLabel: { color: colors.text, fontSize: fontSize.small },
  chipLabelSelected: { color: colors.background, fontWeight: "600" },
  freeText: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: fontSize.small,
    padding: spacing.sm,
    minHeight: 56,
  },
});
