// FILE: timeline.ts
// Purpose: Interleave messages, activities, plans and checkpoints into the flat
//          row list the thread screen virtualizes.
// Layer: Mobile thread logic
// Exports: TimelineRow and its variants, deriveTimelineRows.
//
// Conceptually a much smaller apps/web/src/components/chat/MessagesTimeline.logic.ts
// (deriveMessagesTimelineRows). The web version interleaves per-message
// `textSegments` with tool rows so streamed reasoning renders in execution
// order; v1 mobile renders one block per assistant message instead (see README
// "What's deferred") because segment interleaving needs the row-boundary
// bookkeeping that makes that file 1200 lines.
//
// Ordering key: everything carries an orchestration `sequence` (messages do not,
// so they sort by `createdAt` against the activity clock). Ties break on a
// stable rank so a message and the activity it caused keep a fixed order.

import type {
  OrchestrationCheckpointSummary,
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationThreadActivity,
} from "@synara/contracts";

import { orderedActivities } from "./activityOrder";
import {
  isToolLifecycleActivity,
  summarizeToolEntries,
  toolEntryFromActivity,
  type ToolCallGroupSummary,
  type ToolEntry,
} from "./toolCall";

export interface UserMessageRow {
  readonly kind: "user-message";
  readonly key: string;
  readonly message: OrchestrationMessage;
}

export interface AssistantMessageRow {
  readonly kind: "assistant-message";
  readonly key: string;
  readonly message: OrchestrationMessage;
}

export interface ToolGroupRow {
  readonly kind: "tool-group";
  readonly key: string;
  readonly entries: readonly ToolEntry[];
  /** Null when the run is too short to collapse; the screen renders it expanded. */
  readonly summary: ToolCallGroupSummary | null;
}

export interface ActivityRow {
  readonly kind: "activity";
  readonly key: string;
  readonly activity: OrchestrationThreadActivity;
}

export interface ErrorRow {
  readonly kind: "error";
  readonly key: string;
  readonly activity: OrchestrationThreadActivity;
}

export interface ProposedPlanRow {
  readonly kind: "proposed-plan";
  readonly key: string;
  readonly plan: OrchestrationProposedPlan;
}

export interface CheckpointRow {
  readonly kind: "checkpoint";
  readonly key: string;
  readonly checkpoint: OrchestrationCheckpointSummary;
}

export type TimelineRow =
  | UserMessageRow
  | AssistantMessageRow
  | ToolGroupRow
  | ActivityRow
  | ErrorRow
  | ProposedPlanRow
  | CheckpointRow;

/**
 * Activity kinds that must not become transcript rows.
 *
 * The `approval.*` / `user-input.*` entries are bookkeeping for the composer's
 * pinned cards, which already render them.
 *
 * The rest is per-turn session telemetry. Observed live against the dev server
 * (scripts/smoke-thread.ts), a single four-character reply emits
 * `context-window.configured`, `account.rate-limits.updated`,
 * `context-window.updated` twice, `turn.completed` and `checkpoint.captured` —
 * six muted rows around one word of output. On a desktop sidebar that is
 * ambient detail; on a phone it buries the conversation. `turn.completed` and
 * `checkpoint.captured` are also redundant with the checkpoint marker row,
 * which carries the same information plus a file count.
 */
const SUPPRESSED_ACTIVITY_KINDS = new Set([
  "approval.requested",
  "approval.resolved",
  "user-input.requested",
  "user-input.resolved",
  "context-window.configured",
  "context-window.updated",
  "account.rate-limits.updated",
  "turn.completed",
  "checkpoint.captured",
]);

interface Sortable {
  readonly sequence: number;
  readonly createdAt: string;
  /** Stable tiebreak within one (sequence, createdAt) pair. */
  readonly rank: number;
  readonly row: TimelineRow;
}

const NO_SEQUENCE = Number.MAX_SAFE_INTEGER;

function compareSortable(left: Sortable, right: Sortable): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.sequence - right.sequence ||
    left.rank - right.rank
  );
}

export interface DeriveTimelineRowsInput {
  readonly messages: readonly OrchestrationMessage[];
  readonly activities: readonly OrchestrationThreadActivity[];
  readonly proposedPlans: readonly OrchestrationProposedPlan[];
  readonly checkpoints: readonly OrchestrationCheckpointSummary[];
}

export function deriveTimelineRows(input: DeriveTimelineRowsInput): readonly TimelineRow[] {
  const items: Sortable[] = [];
  let rank = 0;

  for (const message of input.messages) {
    // System messages carry no transcript value on a phone; they are provider
    // preamble the desktop app also hides from the default transcript.
    if (message.role === "system") continue;
    // An assistant message that has not produced text yet would render as an
    // empty bubble; the header's "working" indicator covers that state.
    if (message.role === "assistant" && message.text.trim().length === 0 && message.streaming) {
      continue;
    }
    items.push({
      sequence: NO_SEQUENCE,
      createdAt: message.createdAt,
      rank: (rank += 1),
      row:
        message.role === "user"
          ? { kind: "user-message", key: `message:${message.id}`, message }
          : { kind: "assistant-message", key: `message:${message.id}`, message },
    });
  }

  // Contiguous runs of tool work collapse into one row. "Contiguous" is over the
  // ordered activity list only: a message landing between two tool calls does
  // not split the group, matching how the desktop transcript reads.
  let pendingTools: ToolEntry[] = [];
  const flushTools = (): void => {
    if (pendingTools.length === 0) return;
    const entries = pendingTools;
    pendingTools = [];
    const first = entries[0];
    if (first === undefined) return;
    items.push({
      sequence: first.sequence ?? NO_SEQUENCE,
      createdAt: first.createdAt,
      rank: (rank += 1),
      row: {
        kind: "tool-group",
        key: `tools:${first.id}`,
        entries,
        summary: summarizeToolEntries(entries),
      },
    });
  };

  for (const activity of orderedActivities(input.activities)) {
    if (SUPPRESSED_ACTIVITY_KINDS.has(activity.kind)) continue;

    if (isToolLifecycleActivity(activity)) {
      pendingTools.push(toolEntryFromActivity(activity));
      continue;
    }
    flushTools();
    items.push({
      sequence: activity.sequence ?? NO_SEQUENCE,
      createdAt: activity.createdAt,
      rank: (rank += 1),
      row:
        activity.tone === "error"
          ? { kind: "error", key: `activity:${activity.id}`, activity }
          : { kind: "activity", key: `activity:${activity.id}`, activity },
    });
  }
  flushTools();

  for (const plan of input.proposedPlans) {
    items.push({
      sequence: NO_SEQUENCE,
      createdAt: plan.createdAt,
      rank: (rank += 1),
      row: { kind: "proposed-plan", key: `plan:${plan.id}`, plan },
    });
  }

  for (const checkpoint of input.checkpoints) {
    // A checkpoint with no files is a no-op turn; a marker for it is noise.
    if (checkpoint.files.length === 0) continue;
    items.push({
      sequence: NO_SEQUENCE,
      createdAt: checkpoint.completedAt,
      rank: (rank += 1),
      row: { kind: "checkpoint", key: `checkpoint:${checkpoint.turnId}`, checkpoint },
    });
  }

  return items.toSorted(compareSortable).map((item) => item.row);
}
