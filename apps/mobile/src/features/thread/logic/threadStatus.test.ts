// FILE: threadStatus.test.ts
// Purpose: Header status derivation and the latest-turn diff range.
// Layer: Mobile thread logic (tests)

import { beforeEach, describe, expect, it } from "vitest";

import type { OrchestrationCheckpointSummary, OrchestrationLatestTurn } from "@synara/contracts";

import { nextIso, resetClock, session } from "./fixtures.testutil";
import { parseUnifiedDiff } from "./diff";
import { deriveThreadStatus, isTurnRunning, latestTurnDiffRange } from "./threadStatus";

beforeEach(resetClock);

const runningTurn = {
  turnId: "turn-1",
  state: "running",
  requestedAt: nextIso(),
  startedAt: nextIso(),
  completedAt: null,
  assistantMessageId: null,
} as unknown as OrchestrationLatestTurn;

describe("deriveThreadStatus", () => {
  it("is idle with no session and nothing pending", () => {
    expect(deriveThreadStatus({ session: null, latestTurn: null, pendingCount: 0 })).toBe("idle");
  });

  it("is running while the session holds an active turn", () => {
    const active = session({ status: "running", activeTurnId: "turn-1" });
    expect(deriveThreadStatus({ session: active, latestTurn: null, pendingCount: 0 })).toBe(
      "running",
    );
  });

  it("prefers a pending prompt over running: the turn is blocked on the user", () => {
    const active = session({ status: "running", activeTurnId: "turn-1" });
    expect(deriveThreadStatus({ session: active, latestTurn: runningTurn, pendingCount: 1 })).toBe(
      "awaiting-approval",
    );
  });

  it("stops reporting awaiting-approval once the session can no longer answer", () => {
    const dead = session({ status: "error", lastError: "provider crashed" });
    expect(deriveThreadStatus({ session: dead, latestTurn: null, pendingCount: 1 })).toBe("error");
  });

  it("keeps a prompt actionable before the session snapshot arrives", () => {
    expect(deriveThreadStatus({ session: null, latestTurn: null, pendingCount: 1 })).toBe(
      "awaiting-approval",
    );
  });
});

describe("isTurnRunning", () => {
  it("is false for a settled turn even with a stale running session status", () => {
    const settled = {
      ...runningTurn,
      state: "completed",
      completedAt: nextIso(),
    } as unknown as OrchestrationLatestTurn;
    expect(isTurnRunning(session({ status: "ready", activeTurnId: null }), settled)).toBe(false);
  });

  it("is true from latestTurn alone when the session has not landed", () => {
    expect(isTurnRunning(null, runningTurn)).toBe(true);
  });
});

describe("latestTurnDiffRange", () => {
  const checkpoint = (checkpointTurnCount: number) =>
    ({
      turnId: `turn-${checkpointTurnCount}`,
      checkpointTurnCount,
      checkpointRef: "ref",
      status: "ready",
      files: [],
      assistantMessageId: null,
      completedAt: nextIso(),
    }) as unknown as OrchestrationCheckpointSummary;

  it("is null when nothing has been checkpointed", () => {
    expect(latestTurnDiffRange([])).toBeNull();
    expect(latestTurnDiffRange([checkpoint(0)])).toBeNull();
  });

  it("spans only the newest turn, regardless of array order", () => {
    expect(latestTurnDiffRange([checkpoint(4), checkpoint(2), checkpoint(7)])).toEqual({
      fromTurnCount: 6,
      toTurnCount: 7,
    });
  });

  it("never produces an inverted range the server would reject", () => {
    const range = latestTurnDiffRange([checkpoint(1)]);
    expect(range).toEqual({ fromTurnCount: 0, toTurnCount: 1 });
    expect(range!.fromTurnCount).toBeLessThanOrEqual(range!.toTurnCount);
  });
});

describe("parseUnifiedDiff", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 111..222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,3 +1,3 @@",
    " const keep = 1;",
    "-const old = 2;",
    "+const next = 2;",
    "diff --git a/src/b.ts b/src/b.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/b.ts",
    "@@ -0,0 +1,2 @@",
    "+export const b = 1;",
    "+export const c = 2;",
  ].join("\n");

  it("is empty for an empty diff", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  it("splits into one section per file with its display path", () => {
    const sections = parseUnifiedDiff(diff);
    expect(sections.map((section) => section.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("counts additions and deletions without miscounting the +++/--- headers", () => {
    const [first, second] = parseUnifiedDiff(diff);
    expect(first?.additions).toBe(1);
    expect(first?.deletions).toBe(1);
    expect(second?.additions).toBe(2);
    expect(second?.deletions).toBe(0);
  });

  it("classifies hunk, meta, add, remove and context lines", () => {
    const [first] = parseUnifiedDiff(diff);
    const byKind = new Set(first?.lines.map((line) => line.kind));
    expect([...byKind].toSorted()).toEqual(["add", "context", "hunk", "meta", "remove"]);
  });

  it("handles a bare unified diff with no git preamble", () => {
    const sections = parseUnifiedDiff("--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n");
    expect(sections).toHaveLength(1);
    expect(sections[0]?.path).toBe("x.ts");
  });
});
