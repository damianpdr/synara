// FILE: threadStore.ts
// Purpose: Thread-scoped state: detail subscriptions, drafts, sending, pending
//          interaction responses, and the turn-diff fetch.
// Layer: Mobile state
// Exports: useThreadStore, useThreadDetail, THREAD_RETENTION_MS, MAX_THREAD_STREAMS.
//
// Separate from synaraStore because the lifetimes differ: the connection and the
// shell projection live for the whole process, while thread detail is entered and
// left. Subscriptions are refcounted with a retention window so tapping back and
// forth between the list and a thread does not thrash the server's per-client
// thread-stream lease (8 max) — a re-entry inside the window reuses the live
// stream and repaints from cached detail with no snapshot round trip.
//
// The ConnectionManager is never cached: `getConnectionManager()` is called per
// operation because re-pairing replaces the instance, and a stale reference
// would dispatch into a dead socket.

import { create } from "zustand";

import type {
  ApprovalRequestId,
  ClientOrchestrationCommand,
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
  ThreadId,
} from "@synara/contracts";

import { getConnectionManager, useSynaraStore } from "@/state/synaraStore";
import {
  applyThreadStreamItem,
  emptyThreadDetail,
  type ThreadDetail,
} from "@/state/threadProjection";
import type { ConnectionManager, Subscription } from "@/transport/connectionManager";
import { newId } from "@/transport/ids";
import { latestTurnDiffRange } from "@/features/thread/logic/threadStatus";

/** How long a stream stays open after the last screen using it unmounts. */
export const THREAD_RETENTION_MS = 30_000;
/** The server's per-connection thread-stream lease budget (apps/server/src/wsRpc.ts). */
export const MAX_THREAD_STREAMS = 8;

export interface TurnDiffState {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly diff: string | null;
  readonly error: string | null;
  readonly fromTurnCount: number | null;
  readonly toTurnCount: number | null;
}

const IDLE_DIFF: TurnDiffState = {
  status: "idle",
  diff: null,
  error: null,
  fromTurnCount: null,
  toTurnCount: null,
};

interface ThreadStoreState {
  readonly details: Readonly<Record<string, ThreadDetail>>;
  /** Composer text, per thread, for the life of the process. */
  readonly drafts: Readonly<Record<string, string>>;
  /** Request ids with an in-flight response dispatch, for the optimistic card state. */
  readonly responding: Readonly<Record<string, true>>;
  readonly sending: Readonly<Record<string, true>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly diffs: Readonly<Record<string, TurnDiffState>>;

  /** Subscribes (or joins an existing subscription); returns the release function. */
  retainThread(threadId: ThreadId): () => void;
  setDraft(threadId: ThreadId, draft: string): void;
  dismissError(threadId: ThreadId): void;

  sendMessage(threadId: ThreadId, text: string): Promise<boolean>;
  interruptTurn(threadId: ThreadId): Promise<boolean>;
  respondToApproval(input: {
    readonly threadId: ThreadId;
    readonly requestId: ApprovalRequestId;
    readonly lifecycleGeneration?: string | undefined;
    readonly decision: ProviderApprovalDecision;
  }): Promise<boolean>;
  respondToUserInput(input: {
    readonly threadId: ThreadId;
    readonly requestId: ApprovalRequestId;
    readonly lifecycleGeneration?: string | undefined;
    readonly answers: ProviderUserInputAnswers;
  }): Promise<boolean>;
  loadLatestTurnDiff(threadId: ThreadId): Promise<void>;
}

interface ThreadLease {
  refCount: number;
  subscription: Subscription | null;
  /** The manager the subscription was opened on; an identity change forces a reopen. */
  manager: ConnectionManager | null;
  releaseTimer: ReturnType<typeof setTimeout> | null;
}

const leases = new Map<string, ThreadLease>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Opens (or reopens) the thread stream for a lease against the *current*
 * manager. Module scope rather than a store closure because the manager-swap
 * subscription at the bottom of this file needs it too.
 */
function openStream(threadId: ThreadId, lease: ThreadLease): void {
  const manager = getConnectionManager();
  if (!manager) return;
  if (leases.size > MAX_THREAD_STREAMS) {
    // Retention can only ever hold a handful of leases open; if the budget is
    // somehow exhausted, drop an idle one rather than let the server reject the
    // subscribe.
    for (const other of leases.values()) {
      if (other.refCount === 0 && other.subscription !== null) {
        other.subscription.close();
        other.subscription = null;
        other.manager = null;
        break;
      }
    }
  }
  lease.manager = manager;
  lease.subscription = manager.subscribeThread(threadId, (item) => {
    const details = useThreadStore.getState().details;
    const current = details[threadId] ?? emptyThreadDetail;
    useThreadStore.setState({
      details: { ...details, [threadId]: applyThreadStreamItem(current, item) },
    });
  });
}

export const useThreadStore = create<ThreadStoreState>((set, get) => {
  function patchRecord<T>(
    key: keyof Pick<ThreadStoreState, "responding" | "sending" | "errors">,
    id: string,
    value: T | undefined,
  ): void {
    const current = get()[key] as Readonly<Record<string, T>>;
    if (value === undefined) {
      if (!(id in current)) return;
      const next = { ...current };
      delete next[id];
      set({ [key]: next } as unknown as Partial<ThreadStoreState>);
      return;
    }
    set({ [key]: { ...current, [id]: value } } as unknown as Partial<ThreadStoreState>);
  }

  async function dispatch(
    threadId: ThreadId,
    command: ClientOrchestrationCommand,
  ): Promise<boolean> {
    const manager = getConnectionManager();
    const client = manager?.getClient();
    if (!client) {
      patchRecord("errors", threadId, "Not connected.");
      return false;
    }
    try {
      await client.dispatchCommand(command);
      return true;
    } catch (error) {
      patchRecord("errors", threadId, errorMessage(error));
      return false;
    }
  }

  return {
    details: {},
    drafts: {},
    responding: {},
    sending: {},
    errors: {},
    diffs: {},

    retainThread(threadId) {
      let lease = leases.get(threadId);
      if (lease === undefined) {
        lease = { refCount: 0, subscription: null, manager: null, releaseTimer: null };
        leases.set(threadId, lease);
      }
      const held = lease;
      held.refCount += 1;
      if (held.releaseTimer !== null) {
        clearTimeout(held.releaseTimer);
        held.releaseTimer = null;
      }
      // Reopen when the stream was never opened, was dropped by retention, or
      // was opened against a manager instance that has since been replaced.
      if (held.subscription === null || held.manager !== getConnectionManager()) {
        held.subscription?.close();
        held.subscription = null;
        if (!(threadId in get().details)) {
          set({ details: { ...get().details, [threadId]: emptyThreadDetail } });
        }
        openStream(threadId, held);
      }

      let released = false;
      return () => {
        if (released) return;
        released = true;
        held.refCount = Math.max(0, held.refCount - 1);
        if (held.refCount > 0) return;
        held.releaseTimer = setTimeout(() => {
          held.releaseTimer = null;
          if (held.refCount > 0) return;
          held.subscription?.close();
          held.subscription = null;
          held.manager = null;
          leases.delete(threadId);
        }, THREAD_RETENTION_MS);
      };
    },

    setDraft(threadId, draft) {
      set({ drafts: { ...get().drafts, [threadId]: draft } });
    },

    dismissError(threadId) {
      patchRecord("errors", threadId, undefined);
    },

    async sendMessage(threadId, text) {
      const trimmed = text.trim();
      if (trimmed.length === 0) return false;
      const detail = get().details[threadId];
      // runtimeMode / interactionMode are required by ClientThreadTurnStartCommand
      // and are properties of the thread, not of the composer: echo back what the
      // snapshot reported so a turn started from the phone runs exactly as one
      // started from the desktop app would.
      if (!detail?.runtimeMode || !detail.interactionMode) {
        patchRecord("errors", threadId, "Thread detail has not loaded yet.");
        return false;
      }
      patchRecord("sending", threadId, true);
      // Clear the draft optimistically: the sent text reappears as a user
      // message, and leaving it in the box reads as "it didn't send".
      set({ drafts: { ...get().drafts, [threadId]: "" } });
      const command = {
        type: "thread.turn.start",
        commandId: newId("cmd"),
        threadId,
        message: {
          messageId: newId("msg"),
          role: "user",
          text: trimmed,
          attachments: [],
        },
        ...(detail.modelSelection === null ? {} : { modelSelection: detail.modelSelection }),
        runtimeMode: detail.runtimeMode,
        interactionMode: detail.interactionMode,
        createdAt: new Date().toISOString(),
      } as unknown as ClientOrchestrationCommand;
      const ok = await dispatch(threadId, command);
      patchRecord("sending", threadId, undefined);
      if (!ok) {
        // Restore the draft so the text is not lost to a rejected dispatch.
        set({ drafts: { ...get().drafts, [threadId]: trimmed } });
      }
      return ok;
    },

    async interruptTurn(threadId) {
      return dispatch(threadId, {
        type: "thread.turn.interrupt",
        commandId: newId("cmd"),
        threadId,
        createdAt: new Date().toISOString(),
      } as unknown as ClientOrchestrationCommand);
    },

    async respondToApproval({ threadId, requestId, lifecycleGeneration, decision }) {
      patchRecord("responding", requestId, true);
      try {
        return await dispatch(threadId, {
          type: "thread.approval.respond",
          commandId: newId("cmd"),
          threadId,
          requestId,
          ...(lifecycleGeneration === undefined ? {} : { lifecycleGeneration }),
          decision,
          createdAt: new Date().toISOString(),
        } as unknown as ClientOrchestrationCommand);
      } finally {
        // In-flight only. Past the dispatch, the *durable* settlement decides
        // whether the prompt is still answerable: the server echoes our command
        // as `thread.approval-response-requested`, which marks the interaction
        // `responding` and removes it from `derivePendingApprovals`. Keeping a
        // local flag set past that point would survive a `retryable` failure and
        // permanently strand the retry the reducer is built to offer. The card's
        // own `submittedRef` still blocks a double tap in the gap.
        patchRecord("responding", requestId, undefined);
      }
    },

    async respondToUserInput({ threadId, requestId, lifecycleGeneration, answers }) {
      // The command schema accepts null answers, but a null means "unanswered";
      // sending them makes the provider treat skipped questions as explicit
      // empty responses.
      const cleaned: Record<string, string | readonly string[]> = {};
      for (const [key, value] of Object.entries(answers)) {
        if (value === null || value === undefined) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        cleaned[key] = value;
      }
      patchRecord("responding", requestId, true);
      try {
        return await dispatch(threadId, {
          type: "thread.user-input.respond",
          commandId: newId("cmd"),
          threadId,
          requestId,
          ...(lifecycleGeneration === undefined ? {} : { lifecycleGeneration }),
          answers: cleaned,
          createdAt: new Date().toISOString(),
        } as unknown as ClientOrchestrationCommand);
      } finally {
        // In-flight only, for the same reason as respondToApproval.
        patchRecord("responding", requestId, undefined);
      }
    },

    async loadLatestTurnDiff(threadId) {
      const detail = get().details[threadId];
      const range = latestTurnDiffRange(detail?.checkpoints ?? []);
      if (range === null) {
        set({
          diffs: {
            ...get().diffs,
            [threadId]: {
              ...IDLE_DIFF,
              status: "ready",
              diff: "",
            },
          },
        });
        return;
      }
      set({
        diffs: {
          ...get().diffs,
          [threadId]: { ...IDLE_DIFF, status: "loading", ...range },
        },
      });
      const client = getConnectionManager()?.getClient();
      if (!client) {
        set({
          diffs: {
            ...get().diffs,
            [threadId]: { ...IDLE_DIFF, status: "error", error: "Not connected.", ...range },
          },
        });
        return;
      }
      try {
        const result = await client.getTurnDiff({ threadId, ...range });
        set({
          diffs: {
            ...get().diffs,
            [threadId]: { status: "ready", diff: result.diff, error: null, ...range },
          },
        });
      } catch (error) {
        set({
          diffs: {
            ...get().diffs,
            [threadId]: {
              status: "error",
              diff: null,
              error: errorMessage(error),
              ...range,
            },
          },
        });
      }
    },
  };
});

/**
 * Rebinds live leases when the ConnectionManager instance changes.
 *
 * `retainThread` compares manager identity only at mount, which leaves two real
 * holes. A cold start deep-linked into a thread route (expo-router restores the
 * route before `hydrate()` resolves the stored credentials) mounts while
 * `getConnectionManager()` is still null, so `openStream` returns having done
 * nothing and the screen shows "Loading thread…" forever. Re-pairing likewise
 * replaces the manager under a mounted screen, leaving the lease bound to a
 * closed socket.
 *
 * Subscribing to the whole shell store is deliberate: the manager is swapped as
 * part of the same state transitions the store already publishes, so any change
 * is a cheap identity check away from the answer.
 */
useSynaraStore.subscribe(() => {
  const manager = getConnectionManager();
  if (manager === null) return;
  for (const [threadId, lease] of leases) {
    if (lease.refCount === 0 || lease.manager === manager) continue;
    lease.subscription?.close();
    lease.subscription = null;
    openStream(threadId as ThreadId, lease);
  }
});

/** Convenience selector: the detail for one thread, never undefined. */
export function useThreadDetail(threadId: string): ThreadDetail {
  return useThreadStore((state) => state.details[threadId] ?? emptyThreadDetail);
}
