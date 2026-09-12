// FILE: threadProjection.test.ts
// Purpose: The reducer folds snapshots and events the way the server expects.
// Layer: Mobile state (tests)

import { beforeEach, describe, expect, it } from "vitest";

import {
  activity,
  activityEvent,
  approvalResponseRequestedEvent,
  message,
  messageEvent,
  nextIso,
  resetClock,
  resetSequence,
  session,
  sessionEvent,
  threadSnapshot,
  THREAD_ID,
} from "@/features/thread/logic/fixtures.testutil";
import {
  applyThreadDetailEvent,
  applyThreadStreamItem,
  emptyThreadDetail,
  threadDetailFromSnapshot,
  threadDetailPending,
} from "@/state/threadProjection";

beforeEach(() => {
  resetClock();
  resetSequence();
});

describe("threadDetailFromSnapshot", () => {
  it("replaces cached detail wholesale and adopts the snapshot fence", () => {
    const stale = { ...emptyThreadDetail, lastSequence: 9_999, otherEventCount: 12 };
    const detail = applyThreadStreamItem(stale, {
      kind: "snapshot",
      snapshot: threadSnapshot({ title: "Fresh" }, 42),
    });
    expect(detail.title).toBe("Fresh");
    expect(detail.snapshotSequence).toBe(42);
    // Authoritative even though it is lower than the previous cursor.
    expect(detail.lastSequence).toBe(42);
    expect(detail.otherEventCount).toBe(0);
    expect(detail.hasSnapshot).toBe(true);
  });

  it("sorts snapshot activities into causal order and dedupes by id", () => {
    const detail = threadDetailFromSnapshot(
      threadSnapshot({
        activities: [
          activity({ id: "b", kind: "tool.completed", sequence: 3 }),
          activity({ id: "a", kind: "tool.started", sequence: 1 }),
          activity({ id: "a", kind: "tool.started", sequence: 1 }),
        ],
      }),
    );
    expect(detail.activities.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});

describe("applyThreadDetailEvent", () => {
  it("ignores events at or below the applied sequence", () => {
    const detail = threadDetailFromSnapshot(threadSnapshot({}, 500));
    const replay = messageEvent(message({ id: "m1", role: "user", text: "hi" }));
    expect(replay.sequence).toBeLessThan(500);
    expect(applyThreadDetailEvent(detail, replay)).toBe(detail);
  });

  it("appends streaming assistant deltas and replaces on completion", () => {
    let detail = threadDetailFromSnapshot(threadSnapshot({}, 0));
    const createdAt = nextIso();
    detail = applyThreadDetailEvent(
      detail,
      messageEvent(
        message({
          id: "m1",
          role: "assistant",
          text: "Hel",
          streaming: true,
          turnId: "turn-1",
          createdAt,
        }),
      ),
    );
    detail = applyThreadDetailEvent(
      detail,
      messageEvent(
        message({
          id: "m1",
          role: "assistant",
          text: "lo",
          streaming: true,
          turnId: "turn-1",
          createdAt,
        }),
      ),
    );
    expect(detail.messages[0]?.text).toBe("Hello");
    expect(detail.latestTurn?.state).toBe("running");

    // The completion carries the server's authoritative accumulated text.
    detail = applyThreadDetailEvent(
      detail,
      messageEvent(
        message({
          id: "m1",
          role: "assistant",
          text: "Hello world",
          streaming: false,
          turnId: "turn-1",
          createdAt,
        }),
      ),
    );
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]?.text).toBe("Hello world");
    expect(detail.latestTurn?.state).toBe("completed");
    expect(detail.latestTurn?.completedAt).not.toBeNull();
  });

  it("settles a running turn from the session snapshot, not from a turn event", () => {
    let detail = threadDetailFromSnapshot(threadSnapshot({}, 0));
    detail = applyThreadDetailEvent(
      detail,
      sessionEvent(session({ status: "running", activeTurnId: "turn-1" })),
    );
    expect(detail.latestTurn?.state).toBe("running");
    expect(detail.session?.status).toBe("running");

    detail = applyThreadDetailEvent(
      detail,
      sessionEvent(session({ status: "ready", activeTurnId: null })),
    );
    expect(detail.latestTurn?.state).toBe("completed");
  });

  it("does not settle a running turn while the session retains an active turn id", () => {
    let detail = threadDetailFromSnapshot(threadSnapshot({}, 0));
    detail = applyThreadDetailEvent(
      detail,
      sessionEvent(session({ status: "running", activeTurnId: "turn-1" })),
    );
    detail = applyThreadDetailEvent(
      detail,
      sessionEvent(session({ status: "interrupted", activeTurnId: "turn-1" })),
    );
    expect(detail.latestTurn?.state).toBe("running");
  });

  it("settles on error even when the session still holds an active turn", () => {
    let detail = threadDetailFromSnapshot(threadSnapshot({}, 0));
    detail = applyThreadDetailEvent(
      detail,
      sessionEvent(session({ status: "running", activeTurnId: "turn-1" })),
    );
    detail = applyThreadDetailEvent(
      detail,
      sessionEvent(session({ status: "error", activeTurnId: "turn-1", lastError: "boom" })),
    );
    expect(detail.latestTurn?.state).toBe("error");
  });

  it("stamps the orchestration sequence onto appended activities", () => {
    const detail = applyThreadDetailEvent(
      threadDetailFromSnapshot(threadSnapshot({}, 0)),
      activityEvent(activity({ id: "a1", kind: "tool.started", tone: "tool" })),
    );
    expect(detail.activities[0]?.sequence).toBe(detail.lastSequence);
  });

  it("counts unhandled events without losing the cursor", () => {
    const detail = applyThreadDetailEvent(
      threadDetailFromSnapshot(threadSnapshot({}, 0)),
      // `thread.reverted` is intentionally not projected on mobile.
      { ...activityEvent(activity({ id: "x", kind: "noop" })), type: "thread.reverted" } as never,
    );
    expect(detail.otherEventCount).toBe(1);
    expect(detail.lastSequence).toBeGreaterThan(0);
  });
});

const approvalPayload = (requestId: string) => ({
  requestId,
  lifecycleGeneration: "gen-1",
  requestKind: "command",
  detail: 'Bash: {"command":"bun test"}',
  sessionApprovalAvailable: true,
});

describe("pending interaction reconciliation", () => {
  it("adds a settlement on approval.requested and derives an actionable card", () => {
    const requestedAt = nextIso();
    const detail = applyThreadDetailEvent(
      threadDetailFromSnapshot(threadSnapshot({}, 0)),
      activityEvent(
        activity({
          id: "a1",
          kind: "approval.requested",
          tone: "approval",
          payload: approvalPayload("req-1"),
          createdAt: requestedAt,
        }),
      ),
    );
    expect(detail.pendingInteractions).toHaveLength(1);
    expect(detail.pendingInteractions?.[0]?.status).toBe("pending");

    const pending = threadDetailPending(detail, nextIso());
    expect(pending.approvals).toHaveLength(1);
    expect(pending.approvals[0]?.requestKind).toBe("command");
    expect(pending.approvals[0]?.sessionApprovalAvailable).toBe(true);
  });

  it("marks the settlement responding when the server echoes our dispatch", () => {
    let detail = applyThreadDetailEvent(
      threadDetailFromSnapshot(threadSnapshot({}, 0)),
      activityEvent(
        activity({
          id: "a1",
          kind: "approval.requested",
          tone: "approval",
          payload: approvalPayload("req-1"),
        }),
      ),
    );
    const respondedAt = nextIso();
    detail = applyThreadDetailEvent(
      detail,
      approvalResponseRequestedEvent({
        requestId: "req-1",
        lifecycleGeneration: "gen-1",
        decision: "accept",
        createdAt: respondedAt,
      }),
    );
    expect(detail.pendingInteractions?.[0]?.status).toBe("responding");
    expect(detail.pendingInteractions?.[0]?.decision).toBe("accept");

    // A fresh claim is not re-offered to the UI...
    expect(threadDetailPending(detail, respondedAt).approvals).toHaveLength(0);
    // ...but an orphaned one past the reclaim grace window is.
    const muchLater = new Date(Date.parse(respondedAt) + 120_000).toISOString();
    expect(threadDetailPending(detail, muchLater).approvals).toHaveLength(1);
  });

  it("drops the settlement and the card on approval.resolved", () => {
    let detail = applyThreadDetailEvent(
      threadDetailFromSnapshot(threadSnapshot({}, 0)),
      activityEvent(
        activity({
          id: "a1",
          kind: "approval.requested",
          tone: "approval",
          payload: approvalPayload("req-1"),
        }),
      ),
    );
    detail = applyThreadDetailEvent(
      detail,
      activityEvent(
        activity({
          id: "a2",
          kind: "approval.resolved",
          tone: "approval",
          payload: { requestId: "req-1", lifecycleGeneration: "gen-1" },
        }),
      ),
    );
    expect(detail.pendingInteractions).toHaveLength(0);
    expect(threadDetailPending(detail, nextIso()).approvals).toHaveLength(0);
  });

  it("marks a failed response retryable rather than resolved", () => {
    let detail = applyThreadDetailEvent(
      threadDetailFromSnapshot(threadSnapshot({}, 0)),
      activityEvent(
        activity({
          id: "a1",
          kind: "approval.requested",
          tone: "approval",
          payload: approvalPayload("req-1"),
        }),
      ),
    );
    const echoAt = nextIso();
    detail = applyThreadDetailEvent(
      detail,
      approvalResponseRequestedEvent({
        requestId: "req-1",
        lifecycleGeneration: "gen-1",
        decision: "accept",
        createdAt: echoAt,
      }),
    );
    const commandId = detail.pendingInteractions?.[0]?.responseCommandId;
    detail = applyThreadDetailEvent(
      detail,
      activityEvent(
        activity({
          id: "a3",
          kind: "provider.approval.respond.failed",
          tone: "error",
          payload: {
            requestId: "req-1",
            lifecycleGeneration: "gen-1",
            responseCommandId: commandId,
            settlementStatus: "retryable",
            detail: "transient provider failure",
          },
        }),
      ),
    );
    expect(detail.pendingInteractions?.[0]?.status).toBe("retryable");
    const pending = threadDetailPending(detail, nextIso());
    expect(pending.approvals).toHaveLength(1);
    // A retryable attempt key re-enables the card's one-shot submit guard.
    expect(pending.approvals[0]?.responseAttemptKey).toBeDefined();
  });

  it("treats an explicit stale-callback failure as terminal", () => {
    let detail = applyThreadDetailEvent(
      threadDetailFromSnapshot(threadSnapshot({}, 0)),
      activityEvent(
        activity({
          id: "a1",
          kind: "approval.requested",
          tone: "approval",
          payload: approvalPayload("req-1"),
        }),
      ),
    );
    detail = applyThreadDetailEvent(
      detail,
      activityEvent(
        activity({
          id: "a2",
          kind: "provider.approval.respond.failed",
          tone: "error",
          payload: {
            requestId: "req-1",
            lifecycleGeneration: "gen-1",
            detail: "Unknown pending approval request req-1",
          },
        }),
      ),
    );
    expect(threadDetailPending(detail, nextIso()).approvals).toHaveLength(0);
  });

  it("derives user-input prompts with their questions", () => {
    const detail = applyThreadDetailEvent(
      threadDetailFromSnapshot(threadSnapshot({}, 0)),
      activityEvent(
        activity({
          id: "a1",
          kind: "user-input.requested",
          tone: "approval",
          payload: {
            requestId: "req-q",
            lifecycleGeneration: "gen-1",
            questions: [
              {
                id: "q1",
                header: "Deploy",
                question: "Which environment?",
                options: [
                  { label: "staging", description: "Safe" },
                  { label: "production", description: "Careful" },
                ],
                multiSelect: false,
              },
            ],
          },
        }),
      ),
    );
    const pending = threadDetailPending(detail, nextIso());
    expect(pending.userInputs).toHaveLength(1);
    expect(pending.userInputs[0]?.questions[0]?.options).toHaveLength(2);
  });

  it("derives from a snapshot's activities and settlement list together", () => {
    const requestedAt = nextIso();
    const detail = threadDetailFromSnapshot(
      threadSnapshot({
        activities: [
          activity({
            id: "a1",
            kind: "approval.requested",
            tone: "approval",
            sequence: 1,
            payload: approvalPayload("req-1"),
            createdAt: requestedAt,
          }),
          activity({
            id: "a2",
            kind: "approval.requested",
            tone: "approval",
            sequence: 2,
            payload: approvalPayload("req-2"),
            createdAt: nextIso(),
          }),
        ],
        // The durable list is authoritative: req-2 is already confirmed.
        pendingInteractions: [
          {
            interactionKind: "approval",
            requestId: "req-1",
            threadId: THREAD_ID,
            turnId: null,
            lifecycleGeneration: "gen-1",
            status: "pending",
            decision: null,
            responseCommandId: null,
            responseRequestedAt: null,
            createdAt: requestedAt,
            resolvedAt: null,
          },
        ],
      }),
    );
    const pending = threadDetailPending(detail, nextIso());
    expect(pending.approvals.map((approval) => approval.requestId)).toEqual(["req-1"]);
  });
});
