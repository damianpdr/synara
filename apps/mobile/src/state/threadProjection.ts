// FILE: threadProjection.ts
// Purpose: Pure reducer folding a thread-detail stream (snapshot + events) into
//          the state the thread screen renders.
// Layer: Mobile state
// Exports: ThreadDetail, emptyThreadDetail, threadDetailFromSnapshot,
//          applyThreadDetailEvent, applyThreadStreamItem, threadDetailPending,
//          plus the v1 compatibility shims ThreadProjection /
//          emptyThreadProjection / applyThreadItem consumed by synaraStore.ts.
//
// Portable by design: no React, no React Native, no Effect. `@synara/contracts`
// is a type-only import, so nothing from the schema runtime reaches the bundle.
//
// Event handling is ported from apps/web/src/storeEventReducer.ts. Everything
// the phone does not render (pinned messages, sidechat lifecycle, goal timing,
// notes, subagent routing, handoffs) is deliberately skipped: unhandled events
// still advance `lastSequence` and bump `otherEventCount`.

import type {
  OrchestrationCheckpointSummary,
  OrchestrationEvent,
  OrchestrationLatestTurn,
  OrchestrationMessage,
  OrchestrationPendingInteraction,
  OrchestrationProposedPlan,
  OrchestrationSession,
  OrchestrationThreadActivity,
  OrchestrationThreadDetailSnapshot,
  OrchestrationThreadStreamItem,
  ThreadId,
} from "@synara/contracts";

import { compareActivitiesByOrder } from "@/features/thread/logic/activityOrder";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  markInteractionResponding,
  reconcilePendingInteractionsFromActivity,
  type PendingApproval,
  type PendingUserInput,
} from "@/features/thread/logic/pendingInteractions";

/** Matches apps/web's transcript cap so a very long thread cannot exhaust RAM. */
export const MAX_THREAD_MESSAGES = 400;
/** Activities are far more numerous than messages; the phone only renders a tail. */
export const MAX_THREAD_ACTIVITIES = 1_500;

export interface ThreadDetail {
  readonly threadId: ThreadId | null;
  readonly title: string | null;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly runtimeMode: string | null;
  readonly interactionMode: string | null;
  readonly modelSelection: OrchestrationThreadDetailSnapshot["thread"]["modelSelection"] | null;
  readonly messages: readonly OrchestrationMessage[];
  readonly activities: readonly OrchestrationThreadActivity[];
  readonly proposedPlans: readonly OrchestrationProposedPlan[];
  readonly checkpoints: readonly OrchestrationCheckpointSummary[];
  readonly pendingInteractions: readonly OrchestrationPendingInteraction[] | undefined;
  readonly session: OrchestrationSession | null;
  readonly latestTurn: OrchestrationLatestTurn | null;
  /** Fence from the last snapshot; events at or below it are replays. */
  readonly snapshotSequence: number;
  /** Highest orchestration sequence applied, for duplicate suppression. */
  readonly lastSequence: number;
  /** True once a snapshot has landed — distinguishes "empty" from "loading". */
  readonly hasSnapshot: boolean;
  /** Events observed but not projected. Kept as a liveness signal. */
  readonly otherEventCount: number;
}

export const emptyThreadDetail: ThreadDetail = {
  threadId: null,
  title: null,
  branch: null,
  worktreePath: null,
  runtimeMode: null,
  interactionMode: null,
  modelSelection: null,
  messages: [],
  activities: [],
  proposedPlans: [],
  checkpoints: [],
  pendingInteractions: undefined,
  session: null,
  latestTurn: null,
  snapshotSequence: 0,
  lastSequence: 0,
  hasSnapshot: false,
  otherEventCount: 0,
};

export function threadDetailFromSnapshot(
  snapshot: OrchestrationThreadDetailSnapshot,
): ThreadDetail {
  const thread = snapshot.thread;
  return {
    threadId: thread.id,
    title: thread.title,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    modelSelection: thread.modelSelection,
    messages: thread.messages.slice(-MAX_THREAD_MESSAGES),
    activities: normalizeActivities(thread.activities),
    proposedPlans: thread.proposedPlans,
    checkpoints: thread.checkpoints,
    pendingInteractions: thread.pendingInteractions,
    session: thread.session,
    latestTurn: thread.latestTurn,
    snapshotSequence: snapshot.snapshotSequence,
    lastSequence: snapshot.snapshotSequence,
    hasSnapshot: true,
    otherEventCount: 0,
  };
}

// ------------------------------------------------------------------ helpers

function normalizeActivities(
  activities: readonly OrchestrationThreadActivity[],
): readonly OrchestrationThreadActivity[] {
  const byId = new Map<string, OrchestrationThreadActivity>();
  for (const activity of activities) byId.set(activity.id, activity);
  const deduped = byId.size === activities.length ? [...activities] : [...byId.values()];
  deduped.sort(compareActivitiesByOrder);
  return deduped.length > MAX_THREAD_ACTIVITIES ? deduped.slice(-MAX_THREAD_ACTIVITIES) : deduped;
}

/**
 * Merge rule ported from apps/web/src/storeEventReducer.ts::mergeStreamingMessage.
 * A streaming delta appends; a non-streaming completion carries the server's
 * authoritative accumulated text and replaces wholesale, so a duplicated or
 * diverged local stream cannot survive the turn settling.
 */
function mergeMessageText(existing: OrchestrationMessage, incoming: OrchestrationMessage): string {
  if (existing.role === "user" && incoming.role === "user" && !incoming.streaming) {
    return incoming.text;
  }
  if (incoming.streaming || incoming.text.length === 0) {
    return `${existing.text}${incoming.text}`;
  }
  return incoming.text;
}

function upsertMessage(
  messages: readonly OrchestrationMessage[],
  incoming: OrchestrationMessage,
): readonly OrchestrationMessage[] {
  // Streaming deltas target the newest message, so a backward scan finds it in
  // O(1) rather than walking the whole transcript on every delta.
  let index = -1;
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    if (messages[at]?.id === incoming.id) {
      index = at;
      break;
    }
  }
  if (index === -1) {
    const next = [...messages, incoming];
    return next.length > MAX_THREAD_MESSAGES ? next.slice(-MAX_THREAD_MESSAGES) : next;
  }
  const existing = messages[index];
  if (existing === undefined) return messages;
  const merged: OrchestrationMessage = {
    ...existing,
    ...incoming,
    text: mergeMessageText(existing, incoming),
  };
  const next = [...messages];
  next[index] = merged;
  return next;
}

/**
 * Ported from apps/web/src/storeEventReducer.ts::reconcileLatestTurnFromSession.
 * A running turn is *closed by the session snapshot*, not by any turn event —
 * without this the header status pill sticks on "running" forever.
 */
function reconcileLatestTurnFromSession(
  latestTurn: OrchestrationLatestTurn | null,
  session: OrchestrationSession,
): OrchestrationLatestTurn | null {
  if (session.status === "running" && session.activeTurnId != null) {
    const isSameTurn = latestTurn?.turnId === session.activeTurnId;
    return {
      turnId: session.activeTurnId,
      state: "running",
      requestedAt: isSameTurn ? latestTurn.requestedAt : session.updatedAt,
      startedAt: isSameTurn ? (latestTurn.startedAt ?? session.updatedAt) : session.updatedAt,
      completedAt: null,
      assistantMessageId: isSameTurn ? latestTurn.assistantMessageId : null,
    };
  }

  const settledState =
    session.status === "error"
      ? ("error" as const)
      : session.status === "interrupted" || session.status === "stopped"
        ? ("interrupted" as const)
        : session.status === "ready"
          ? ("completed" as const)
          : null;
  // A retained activeTurnId blocks settlement (except on error): stop-requested
  // flows report "interrupted" while the provider's terminal event still
  // decides the real outcome. A stale non-error snapshot that predates the
  // running turn must not close a just-started turn either.
  if (
    settledState !== null &&
    latestTurn !== null &&
    latestTurn.state === "running" &&
    (session.activeTurnId == null || settledState === "error") &&
    (settledState === "error" ||
      session.updatedAt >= (latestTurn.startedAt ?? latestTurn.requestedAt))
  ) {
    return { ...latestTurn, state: settledState, completedAt: session.updatedAt };
  }
  return latestTurn;
}

/**
 * Ported from apps/web/src/storeEventReducer.ts::applyThreadMessageSentEvent:
 * an assistant message for the latest turn also carries that turn's liveness.
 */
function reconcileLatestTurnFromMessage(
  latestTurn: OrchestrationLatestTurn | null,
  message: OrchestrationMessage,
): OrchestrationLatestTurn | null {
  if (message.role !== "assistant" || message.turnId === null) return latestTurn;
  if (latestTurn !== null && latestTurn.turnId !== message.turnId) return latestTurn;
  const state = message.streaming
    ? ("running" as const)
    : latestTurn?.state === "interrupted"
      ? ("interrupted" as const)
      : latestTurn?.state === "error"
        ? ("error" as const)
        : ("completed" as const);
  return {
    turnId: message.turnId,
    state,
    requestedAt: latestTurn?.requestedAt ?? message.createdAt,
    startedAt: latestTurn?.startedAt ?? message.createdAt,
    completedAt: message.streaming ? (latestTurn?.completedAt ?? null) : message.updatedAt,
    assistantMessageId: message.id,
  };
}

function upsertCheckpoint(
  checkpoints: readonly OrchestrationCheckpointSummary[],
  next: OrchestrationCheckpointSummary,
): readonly OrchestrationCheckpointSummary[] {
  const index = checkpoints.findIndex((entry) => entry.turnId === next.turnId);
  if (index === -1) return [...checkpoints, next];
  const copy = [...checkpoints];
  copy[index] = next;
  return copy;
}

// ------------------------------------------------------------------ reducer

/**
 * Folds one orchestration event into the detail. Events at or below
 * `lastSequence` are replays (a reconnect resumes from the cursor inclusive on
 * some paths) and are ignored.
 */
export function applyThreadDetailEvent(
  detail: ThreadDetail,
  event: OrchestrationEvent,
): ThreadDetail {
  if (event.sequence <= detail.lastSequence) return detail;
  const base = { ...detail, lastSequence: event.sequence };

  switch (event.type) {
    case "thread.message-sent": {
      const incoming: OrchestrationMessage = {
        id: event.payload.messageId,
        role: event.payload.role,
        text: event.payload.text,
        turnId: event.payload.turnId,
        streaming: event.payload.streaming,
        source: event.payload.source,
        createdAt: event.payload.createdAt,
        updatedAt: event.payload.updatedAt,
        ...(event.payload.attachments === undefined
          ? {}
          : { attachments: event.payload.attachments }),
      };
      const messages = upsertMessage(base.messages, incoming);
      // Re-read the merged row so the turn reconciliation sees the accumulated
      // text's streaming flag rather than the raw delta's.
      const merged = messages.find((message) => message.id === incoming.id) ?? incoming;
      return {
        ...base,
        messages,
        latestTurn: reconcileLatestTurnFromMessage(base.latestTurn, merged),
      };
    }

    case "thread.activity-appended": {
      // Stamping the orchestration sequence onto the activity is what makes
      // `compareActivitiesByOrder` a causal order rather than a clock order.
      const activity: OrchestrationThreadActivity = {
        ...event.payload.activity,
        sequence: event.payload.activity.sequence ?? event.sequence,
      };
      return {
        ...base,
        activities: normalizeActivities([...base.activities, activity]),
        pendingInteractions: reconcilePendingInteractionsFromActivity(
          event.payload.threadId,
          base.pendingInteractions,
          activity,
        ),
      };
    }

    case "thread.session-set":
      return {
        ...base,
        session: event.payload.session,
        latestTurn: reconcileLatestTurnFromSession(base.latestTurn, event.payload.session),
      };

    case "thread.approval-response-requested":
      return {
        ...base,
        pendingInteractions: markInteractionResponding(base.pendingInteractions, {
          interactionKind: "approval",
          requestId: event.payload.requestId,
          lifecycleGeneration: event.payload.lifecycleGeneration ?? null,
          decision: event.payload.decision,
          commandId: event.commandId,
          createdAt: event.payload.createdAt,
        }),
      };

    case "thread.user-input-response-requested":
      return {
        ...base,
        pendingInteractions: markInteractionResponding(base.pendingInteractions, {
          interactionKind: "userInput",
          requestId: event.payload.requestId,
          lifecycleGeneration: event.payload.lifecycleGeneration ?? null,
          decision: null,
          commandId: event.commandId,
          createdAt: event.payload.createdAt,
        }),
      };

    case "thread.proposed-plan-upserted": {
      const plan = event.payload.proposedPlan;
      const index = base.proposedPlans.findIndex((entry) => entry.id === plan.id);
      const proposedPlans =
        index === -1
          ? [...base.proposedPlans, plan]
          : base.proposedPlans.map((entry, at) => (at === index ? plan : entry));
      return { ...base, proposedPlans };
    }

    case "thread.turn-diff-completed":
      return {
        ...base,
        checkpoints: upsertCheckpoint(base.checkpoints, {
          turnId: event.payload.turnId,
          checkpointTurnCount: event.payload.checkpointTurnCount,
          checkpointRef: event.payload.checkpointRef,
          status: event.payload.status,
          files: event.payload.files,
          assistantMessageId: event.payload.assistantMessageId,
          completedAt: event.payload.completedAt,
        }),
      };

    case "thread.meta-updated":
      return {
        ...base,
        ...(event.payload.title === undefined ? {} : { title: event.payload.title }),
        ...(event.payload.branch === undefined ? {} : { branch: event.payload.branch }),
        ...(event.payload.worktreePath === undefined
          ? {}
          : { worktreePath: event.payload.worktreePath }),
        ...(event.payload.modelSelection === undefined
          ? {}
          : { modelSelection: event.payload.modelSelection }),
      };

    case "thread.turn-start-requested":
      // The turn itself arrives via session-set / message-sent; this only keeps
      // the modes the composer echoes in sync with what actually ran.
      return {
        ...base,
        runtimeMode: event.payload.runtimeMode,
        interactionMode: event.payload.interactionMode,
        ...(event.payload.modelSelection === undefined
          ? {}
          : { modelSelection: event.payload.modelSelection }),
      };

    default:
      return { ...base, otherEventCount: base.otherEventCount + 1 };
  }
}

export function applyThreadStreamItem(
  detail: ThreadDetail,
  item: OrchestrationThreadStreamItem,
): ThreadDetail {
  // A snapshot replaces cached detail wholesale: its fence is authoritative
  // even when lower than the previous cursor (resnapshot after a stall).
  return item.kind === "snapshot"
    ? threadDetailFromSnapshot(item.snapshot)
    : applyThreadDetailEvent(detail, item.event);
}

export interface ThreadPendingInteractions {
  readonly approvals: readonly PendingApproval[];
  readonly userInputs: readonly PendingUserInput[];
}

/**
 * The prompts the composer should pin. `nowIso` is the wall-clock reference the
 * orphaned-claim policy needs; pass `new Date().toISOString()` from the screen.
 */
export function threadDetailPending(
  detail: ThreadDetail,
  nowIso: string,
): ThreadPendingInteractions {
  return {
    approvals: derivePendingApprovals(detail.activities, detail.pendingInteractions, nowIso),
    userInputs: derivePendingUserInputs(detail.activities, detail.pendingInteractions, nowIso),
  };
}

// ------------------------------------------------ v1 compatibility shims
//
// `src/state/synaraStore.ts` (owned by the shell work) still imports these
// three names. They are kept as thin wrappers over the reducer above so that
// file needs no edit; the thread screen itself reads `ThreadDetail` directly.

export interface ThreadProjection extends ThreadDetail {
  readonly detail: ThreadDetail;
}

export const emptyThreadProjection: ThreadProjection = {
  ...emptyThreadDetail,
  detail: emptyThreadDetail,
};

export function applyThreadItem(
  projection: ThreadProjection,
  item: OrchestrationThreadStreamItem,
): ThreadProjection {
  const detail = applyThreadStreamItem(projection.detail, item);
  return { ...detail, detail };
}
