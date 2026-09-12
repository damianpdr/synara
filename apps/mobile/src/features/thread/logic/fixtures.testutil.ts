// FILE: fixtures.testutil.ts
// Purpose: Minimal builders for orchestration shapes used by the thread tests.
// Layer: Mobile thread logic (test support)
// Exports: activity, message, threadSnapshot, activityEvent, messageEvent, sessionEvent.
//
// The contracts package is Effect-based, so its schema constructors cannot be
// called here (type-only dependency). These builders cast structurally-correct
// literals instead, which is exactly what the reducer receives off the wire.

import type {
  OrchestrationEvent,
  OrchestrationMessage,
  OrchestrationSession,
  OrchestrationThreadActivity,
  OrchestrationThreadDetailSnapshot,
} from "@synara/contracts";

export const THREAD_ID = "thread-1";

let clock = 0;
/** Monotonic ISO timestamps so ordering assertions are not clock-flaky. */
export function nextIso(): string {
  clock += 1000;
  return new Date(Date.UTC(2025, 0, 1) + clock).toISOString();
}

export function resetClock(): void {
  clock = 0;
}

// Ids in the contracts are *branded* strings (`string & Brand<"EventId">`), and
// the brand can only be applied by an Effect schema constructor — which this
// package cannot call. Overrides are therefore typed loosely and cast once at
// the boundary, which is exactly the shape that arrives off the wire anyway.
type Loose<T> = { [K in keyof T]?: unknown };

export function activity(
  overrides: Loose<OrchestrationThreadActivity> & { readonly id: string; readonly kind: string },
): OrchestrationThreadActivity {
  return {
    tone: "info",
    summary: overrides.kind,
    payload: null,
    turnId: null,
    createdAt: nextIso(),
    ...overrides,
  } as unknown as OrchestrationThreadActivity;
}

export function message(
  overrides: Loose<OrchestrationMessage> & { readonly id: string; readonly role: string },
): OrchestrationMessage {
  const createdAt = (overrides.createdAt as string | undefined) ?? nextIso();
  return {
    text: "",
    turnId: null,
    streaming: false,
    source: "native",
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  } as unknown as OrchestrationMessage;
}

export function session(overrides: Loose<OrchestrationSession> = {}): OrchestrationSession {
  return {
    threadId: THREAD_ID,
    status: "ready",
    providerName: "claudeAgent",
    runtimeMode: "approval-required",
    activeTurnId: null,
    lastError: null,
    updatedAt: nextIso(),
    ...overrides,
  } as unknown as OrchestrationSession;
}

export function threadSnapshot(
  overrides: Loose<OrchestrationThreadDetailSnapshot["thread"]> = {},
  snapshotSequence = 10,
): OrchestrationThreadDetailSnapshot {
  return {
    snapshotSequence,
    thread: {
      id: THREAD_ID,
      projectId: "project-1",
      title: "Test thread",
      modelSelection: { provider: "claudeAgent", model: "claude-sonnet-5" },
      runtimeMode: "approval-required",
      interactionMode: "default",
      branch: "feat/test",
      worktreePath: "/tmp/wt",
      latestTurn: null,
      createdAt: nextIso(),
      updatedAt: nextIso(),
      deletedAt: null,
      handoff: null,
      sidechatSourceThreadId: null,
      sidechatLastActivityAt: null,
      sidechatExpiredAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      pendingInteractions: [],
      checkpoints: [],
      session: null,
      ...overrides,
    },
  } as unknown as OrchestrationThreadDetailSnapshot;
}

let sequence = 100;
function baseEvent(type: string, payload: unknown): OrchestrationEvent {
  sequence += 1;
  return {
    sequence,
    eventId: `event-${sequence}`,
    aggregateKind: "thread",
    aggregateId: THREAD_ID,
    occurredAt: nextIso(),
    commandId: `cmd-${sequence}`,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type,
    payload,
  } as unknown as OrchestrationEvent;
}

export function resetSequence(): void {
  sequence = 100;
}

export function activityEvent(entry: OrchestrationThreadActivity): OrchestrationEvent {
  return baseEvent("thread.activity-appended", { threadId: THREAD_ID, activity: entry });
}

export function messageEvent(entry: OrchestrationMessage): OrchestrationEvent {
  return baseEvent("thread.message-sent", {
    threadId: THREAD_ID,
    messageId: entry.id,
    role: entry.role,
    text: entry.text,
    turnId: entry.turnId,
    streaming: entry.streaming,
    source: entry.source,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  });
}

export function sessionEvent(entry: OrchestrationSession): OrchestrationEvent {
  return baseEvent("thread.session-set", { threadId: THREAD_ID, session: entry });
}

export function approvalResponseRequestedEvent(input: {
  readonly requestId: string;
  readonly lifecycleGeneration?: string;
  readonly decision: string;
  readonly createdAt: string;
}): OrchestrationEvent {
  return baseEvent("thread.approval-response-requested", {
    threadId: THREAD_ID,
    requestId: input.requestId,
    ...(input.lifecycleGeneration === undefined
      ? {}
      : { lifecycleGeneration: input.lifecycleGeneration }),
    decision: input.decision,
    createdAt: input.createdAt,
  });
}
