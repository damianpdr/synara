// FILE: activityOrder.ts
// Purpose: Stable ordering for thread activities.
// Layer: Mobile thread logic
// Exports: compareActivitiesByOrder, orderedActivities.
//
// Ported from packages/shared/src/threadSummary.ts (compareActivitiesByOrder)
// and apps/web/src/workLog.ts (orderedActivities). Copied rather than imported
// because `@synara/shared` is an Effect-based package and its runtime must
// never enter the React Native bundle — this app depends on it type-only.
// The web version memoizes through a WeakMap; the mobile reducer already
// re-sorts only when the activity list changes identity, so the cache is
// dropped for simplicity.

import type { OrchestrationThreadActivity } from "@synara/contracts";

type OrderableActivity = Pick<OrchestrationThreadActivity, "createdAt" | "id" | "sequence">;

/**
 * Causal order first (`sequence` is the orchestration-event sequence stamped by
 * the reducer), then wall clock, then id as a total-order tiebreak. Activities
 * that predate sequence stamping sort last within their timestamp.
 */
export function compareActivitiesByOrder(
  left: OrderableActivity,
  right: OrderableActivity,
): number {
  const leftSequence = left.sequence ?? Number.MAX_SAFE_INTEGER;
  const rightSequence = right.sequence ?? Number.MAX_SAFE_INTEGER;
  return (
    leftSequence - rightSequence ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

/** Returns the input array unchanged when it is already ordered. */
export function orderedActivities<T extends OrderableActivity>(
  activities: readonly T[],
): readonly T[] {
  for (let index = 1; index < activities.length; index += 1) {
    const previous = activities[index - 1];
    const current = activities[index];
    if (previous === undefined || current === undefined) continue;
    if (compareActivitiesByOrder(previous, current) > 0) {
      return activities.toSorted(compareActivitiesByOrder);
    }
  }
  return activities;
}
