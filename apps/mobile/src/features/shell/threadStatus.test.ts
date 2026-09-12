import { describe, expect, it } from "vitest";

import {
  canSessionAnswerPendingRequests,
  deriveThreadStatus,
  hasLiveLatestTurn,
  isThreadArchived,
  threadStatusLabel,
  threadStatusRank,
  type ThreadStatusInput,
} from "./threadStatus";

const turn = (
  overrides: Partial<NonNullable<ThreadStatusInput["latestTurn"]>> = {},
): NonNullable<ThreadStatusInput["latestTurn"]> => ({
  state: "completed",
  startedAt: "2025-01-01T00:00:00.000Z",
  completedAt: "2025-01-01T00:01:00.000Z",
  ...overrides,
});

describe("canSessionAnswerPendingRequests", () => {
  it("treats a missing session as answerable so flags can arrive first", () => {
    expect(canSessionAnswerPendingRequests(null)).toBe(true);
  });

  it("rejects sessions the web store folds into closed/error", () => {
    expect(canSessionAnswerPendingRequests({ status: "idle" })).toBe(false);
    expect(canSessionAnswerPendingRequests({ status: "stopped" })).toBe(false);
    expect(canSessionAnswerPendingRequests({ status: "error" })).toBe(false);
  });

  it("accepts live and resumable sessions", () => {
    for (const status of ["starting", "running", "ready", "interrupted"]) {
      expect(canSessionAnswerPendingRequests({ status })).toBe(true);
    }
  });
});

describe("hasLiveLatestTurn", () => {
  it("is false before the turn starts", () => {
    expect(hasLiveLatestTurn(turn({ startedAt: null, completedAt: null }), null)).toBe(false);
  });

  it("is true for a started turn that never completed", () => {
    expect(hasLiveLatestTurn(turn({ completedAt: null }), { status: "running" })).toBe(true);
  });

  it("is true for a completed turn whose session is still running", () => {
    expect(hasLiveLatestTurn(turn(), { status: "running" })).toBe(true);
  });

  it("is false once an interrupted turn completes, even on a running session", () => {
    expect(hasLiveLatestTurn(turn({ state: "interrupted" }), { status: "running" })).toBe(false);
  });
});

describe("deriveThreadStatus", () => {
  it("ranks a pending approval above everything else", () => {
    expect(
      deriveThreadStatus({
        latestTurn: turn({ completedAt: null }),
        session: { status: "running" },
        hasPendingApprovals: true,
        hasPendingUserInput: true,
      }),
    ).toBe("needs-approval");
  });

  it("ranks pending user input above running work", () => {
    expect(
      deriveThreadStatus({
        latestTurn: turn({ completedAt: null }),
        session: { status: "running" },
        hasPendingUserInput: true,
      }),
    ).toBe("needs-input");
  });

  it("drops pending flags a dead session can no longer answer", () => {
    expect(
      deriveThreadStatus({
        latestTurn: turn(),
        session: { status: "stopped" },
        hasPendingApprovals: true,
      }),
    ).toBe("idle");
  });

  it("reports a requested-but-not-started turn as running", () => {
    expect(
      deriveThreadStatus({
        latestTurn: turn({ state: "running", startedAt: null, completedAt: null }),
        session: null,
      }),
    ).toBe("running");
  });

  it("reports a starting session as running", () => {
    expect(deriveThreadStatus({ latestTurn: null, session: { status: "starting" } })).toBe(
      "running",
    );
  });

  it("reports a running session with no turn yet as running", () => {
    expect(deriveThreadStatus({ latestTurn: null, session: { status: "running" } })).toBe(
      "running",
    );
  });

  it("reports a failed turn as error", () => {
    expect(
      deriveThreadStatus({ latestTurn: turn({ state: "error" }), session: { status: "ready" } }),
    ).toBe("error");
  });

  it("reports a failed session as error", () => {
    expect(deriveThreadStatus({ latestTurn: turn(), session: { status: "error" } })).toBe("error");
  });

  it("reports a settled thread as idle", () => {
    expect(deriveThreadStatus({ latestTurn: turn(), session: { status: "ready" } })).toBe("idle");
  });

  it("reports a never-run thread as idle", () => {
    expect(deriveThreadStatus({ latestTurn: null, session: null })).toBe("idle");
  });

  it("treats undefined pending flags as false", () => {
    expect(
      deriveThreadStatus({
        latestTurn: turn(),
        session: { status: "ready" },
        hasPendingApprovals: undefined,
        hasPendingUserInput: undefined,
      }),
    ).toBe("idle");
  });
});

describe("threadStatusRank", () => {
  it("orders attention above running above idle", () => {
    expect(threadStatusRank("needs-approval")).toBeLessThan(threadStatusRank("needs-input"));
    expect(threadStatusRank("needs-input")).toBeLessThan(threadStatusRank("error"));
    expect(threadStatusRank("error")).toBeLessThan(threadStatusRank("running"));
    expect(threadStatusRank("running")).toBeLessThan(threadStatusRank("idle"));
  });
});

describe("isThreadArchived", () => {
  it("reads archivedAt", () => {
    expect(isThreadArchived({ archivedAt: null })).toBe(false);
    expect(isThreadArchived({})).toBe(false);
    expect(isThreadArchived({ archivedAt: "2025-01-01T00:00:00.000Z" })).toBe(true);
  });
});

describe("threadStatusLabel", () => {
  it("labels every status", () => {
    expect(threadStatusLabel("needs-approval")).toBe("Approve");
    expect(threadStatusLabel("idle")).toBe("Idle");
  });
});
