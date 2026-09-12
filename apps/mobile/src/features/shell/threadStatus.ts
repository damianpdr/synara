// FILE: threadStatus.ts
// Purpose: Derive a thread's attention status from its shell row.
// Layer: Mobile shell feature
// Exports: ThreadStatus, deriveThreadStatus, threadStatusRank, isThreadArchived, and the
//          session/turn predicates it is built from.
//
// This is a deliberate port of the web app's rules so a thread never reads as
// "working" on the phone and "idle" in the browser:
//   - apps/web/src/session-logic.ts       (isLatestTurnSettled, hasLiveLatestTurn,
//                                          canSessionAnswerPendingRequests)
//   - apps/web/src/components/Sidebar.logic.ts    (isThreadActivelyWorking,
//                                                  resolveThreadStatusPill ordering)
//   - apps/web/src/components/kanban/kanban.logic.ts (deriveKanbanColumn's
//                                          "requested but not started yet" case)
//
// The web store normalises `OrchestrationSessionStatus` into a legacy union
// before applying those rules (storeNormalization.ts::toLegacySessionStatus):
//   starting -> connecting | running -> running | error -> error
//   ready, interrupted -> ready | idle, stopped -> closed
// The mappings below work on the raw orchestration status instead, so the
// translation is inlined where it matters.
//
// Pure and RN-free: only `import type` from @synara/contracts, so it runs under
// vitest without a React Native runtime.

/** Ordered by urgency; `threadStatusRank` depends on this order. */
export type ThreadStatus = "needs-approval" | "needs-input" | "error" | "running" | "idle";

/**
 * Structural subsets of `OrchestrationThreadShell`, so tests can build fixtures
 * without materialising the full ~40-field shell row. Any real shell row
 * satisfies these.
 */
export interface LatestTurnView {
  readonly state: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface SessionView {
  readonly status: string;
}

export interface ThreadStatusInput {
  readonly latestTurn: LatestTurnView | null;
  readonly session: SessionView | null;
  readonly hasPendingApprovals?: boolean | undefined;
  readonly hasPendingUserInput?: boolean | undefined;
}

/** Orchestration statuses the web store folds into the legacy `closed` state. */
const CLOSED_SESSION_STATUSES = new Set(["idle", "stopped"]);

/**
 * A pending approval / input request is only actionable while the session that
 * raised it can still receive the answer. After a provider crash or a clean
 * stop the request is dead, and presenting the thread as "awaiting you" forever
 * is worse than showing it idle. A thread with no session yet keeps the request
 * actionable: the flag can arrive ahead of the session row.
 */
export function canSessionAnswerPendingRequests(session: SessionView | null): boolean {
  if (!session) return true;
  return !CLOSED_SESSION_STATUSES.has(session.status) && session.status !== "error";
}

export function isLatestTurnSettled(
  latestTurn: LatestTurnView | null,
  session: SessionView | null,
): boolean {
  if (!latestTurn?.startedAt) return false;
  if (!latestTurn.completedAt) return false;
  if (latestTurn.state === "interrupted" || latestTurn.state === "error") return true;
  if (!session) return true;
  return session.status !== "running";
}

export function hasLiveLatestTurn(
  latestTurn: LatestTurnView | null,
  session: SessionView | null,
): boolean {
  if (!latestTurn?.startedAt) return false;
  return !isLatestTurnSettled(latestTurn, session);
}

/** "There is live work on this thread right now." */
export function isThreadActivelyWorking(input: ThreadStatusInput): boolean {
  const { latestTurn, session } = input;
  // A turn the server has accepted but not started yet still counts: the row
  // must not flicker through "idle" between dispatch and the first delta.
  if (latestTurn?.state === "running") return true;
  if (session?.status === "starting") return true;
  if (session?.status !== "running") return false;
  return latestTurn === null || hasLiveLatestTurn(latestTurn, session);
}

export function deriveThreadStatus(input: ThreadStatusInput): ThreadStatus {
  const canAnswer = canSessionAnswerPendingRequests(input.session);
  if (input.hasPendingApprovals === true && canAnswer) return "needs-approval";
  if (input.hasPendingUserInput === true && canAnswer) return "needs-input";
  if (isThreadActivelyWorking(input)) return "running";
  if (input.latestTurn?.state === "error" || input.session?.status === "error") return "error";
  return "idle";
}

const STATUS_ORDER: readonly ThreadStatus[] = [
  "needs-approval",
  "needs-input",
  "error",
  "running",
  "idle",
];

/**
 * Sort weight, lowest first. Requests the user can answer outrank a failure the
 * user should look at, which outranks work that is progressing on its own.
 */
export function threadStatusRank(status: ThreadStatus): number {
  return STATUS_ORDER.indexOf(status);
}

/** Statuses that mean "this thread is waiting on the human". */
export function isAttentionStatus(status: ThreadStatus): boolean {
  return status === "needs-approval" || status === "needs-input" || status === "error";
}

export function isThreadArchived(thread: { readonly archivedAt?: string | null }): boolean {
  return thread.archivedAt != null;
}

const STATUS_LABELS: Record<ThreadStatus, string> = {
  "needs-approval": "Approve",
  "needs-input": "Input",
  error: "Failed",
  running: "Working",
  idle: "Idle",
};

export function threadStatusLabel(status: ThreadStatus): string {
  return STATUS_LABELS[status];
}
