// FILE: threadStatus.ts
// Purpose: One label for "what is this thread doing right now", for the header pill.
// Layer: Mobile thread logic
// Exports: ThreadActivityStatus, deriveThreadStatus, isTurnRunning, latestTurnDiffRange.
//
// Rules ported from apps/web/src/session-logic.ts (isSessionRunningTurn,
// isLatestTurnSettled, canSessionAnswerPendingRequests, derivePhase), collapsed
// into the four states the phone header shows.

import type {
  OrchestrationCheckpointSummary,
  OrchestrationSession,
  OrchestrationLatestTurn,
} from "@synara/contracts";

export type ThreadActivityStatus = "running" | "awaiting-approval" | "error" | "idle";

export interface DeriveThreadStatusInput {
  readonly session: OrchestrationSession | null;
  readonly latestTurn: OrchestrationLatestTurn | null;
  readonly pendingCount: number;
}

/** A session is actively running a turn: status `running` *and* a live turn id. */
export function isSessionRunningTurn(session: OrchestrationSession | null): boolean {
  return session !== null && session.status === "running" && session.activeTurnId != null;
}

/**
 * Whether the composer should offer Stop instead of Send. Mirrors
 * `hasLiveLatestTurn`: a turn with no `startedAt` has not begun, and a settled
 * one (completed / interrupted / errored) is done regardless of a stale session.
 */
export function isTurnRunning(
  session: OrchestrationSession | null,
  latestTurn: OrchestrationLatestTurn | null,
): boolean {
  if (isSessionRunningTurn(session)) return true;
  if (latestTurn === null) return false;
  return latestTurn.state === "running" && latestTurn.completedAt === null;
}

/**
 * A pending prompt is only actionable while the session that raised it can still
 * receive the answer; after a provider crash the thread must not read as
 * "awaiting approval" forever. A thread with no session yet keeps it actionable —
 * the flag can arrive ahead of the session snapshot.
 */
export function canSessionAnswerPendingRequests(session: OrchestrationSession | null): boolean {
  if (session === null) return true;
  return session.status !== "stopped" && session.status !== "error";
}

export function deriveThreadStatus(input: DeriveThreadStatusInput): ThreadActivityStatus {
  if (input.pendingCount > 0 && canSessionAnswerPendingRequests(input.session)) {
    // An answerable prompt outranks "running": the turn is blocked on the user.
    return "awaiting-approval";
  }
  if (input.session?.status === "error" || input.latestTurn?.state === "error") return "error";
  if (isTurnRunning(input.session, input.latestTurn)) return "running";
  return "idle";
}

export const THREAD_STATUS_LABELS: Record<ThreadActivityStatus, string> = {
  running: "working",
  "awaiting-approval": "needs you",
  error: "error",
  idle: "idle",
};

export interface TurnDiffRange {
  readonly fromTurnCount: number;
  readonly toTurnCount: number;
}

/**
 * The range covering only the most recent completed turn.
 * `orchestration.getTurnDiff` takes a half-open turn-count window, so the last
 * turn is `[n-1, n]` where `n` is the newest checkpoint's `checkpointTurnCount`
 * (mirrors apps/web/src/components/DiffPanel.tsx's single-checkpoint branch).
 * Returns null when no checkpoint has been recorded — there is nothing to diff.
 */
export function latestTurnDiffRange(
  checkpoints: readonly OrchestrationCheckpointSummary[],
): TurnDiffRange | null {
  let newest: OrchestrationCheckpointSummary | null = null;
  for (const checkpoint of checkpoints) {
    if (newest === null || checkpoint.checkpointTurnCount > newest.checkpointTurnCount) {
      newest = checkpoint;
    }
  }
  if (newest === null || newest.checkpointTurnCount <= 0) return null;
  return {
    fromTurnCount: Math.max(0, newest.checkpointTurnCount - 1),
    toTurnCount: newest.checkpointTurnCount,
  };
}
