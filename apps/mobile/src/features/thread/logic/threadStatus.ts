// FILE: threadStatus.ts
// Purpose: Turn-level predicates the thread screen needs beyond the shared status rules.
// Layer: Mobile thread logic
// Exports: isSessionRunningTurn, isTurnRunning, latestTurnDiffRange.
//
// The *attention* status ("needs approval / needs input / error / running /
// idle") is NOT derived here: `src/features/shell/threadStatus.ts` owns it, and
// the thread header calls that so the header pill and the list row can never
// disagree about the same thread. What is left here is the separate question
// "is there a turn I could interrupt right now", which drives the composer's
// Stop button, plus the checkpoint range the Changes sheet fetches.
//
// Rules ported from apps/web/src/session-logic.ts (isSessionRunningTurn,
// hasLiveLatestTurn).

import type {
  OrchestrationCheckpointSummary,
  OrchestrationSession,
  OrchestrationLatestTurn,
} from "@synara/contracts";

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
