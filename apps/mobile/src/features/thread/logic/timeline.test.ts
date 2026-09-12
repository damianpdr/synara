// FILE: timeline.test.ts
// Purpose: Timeline row derivation and tool-call grouping.
// Layer: Mobile thread logic (tests)

import { beforeEach, describe, expect, it } from "vitest";

import { activity, message, nextIso, resetClock } from "./fixtures.testutil";
import { deriveTimelineRows, type TimelineRow } from "./timeline";
import {
  classifyToolEntry,
  deriveCommandDisplay,
  summarizeToolEntries,
  toolEntryFromActivity,
} from "./toolCall";

beforeEach(resetClock);

const empty = { messages: [], activities: [], proposedPlans: [], checkpoints: [] } as const;

function kinds(rows: readonly TimelineRow[]): string[] {
  return rows.map((row) => row.kind);
}

function toolActivity(id: string, sequence: number, command: string, kind = "tool.completed") {
  return activity({
    id,
    kind,
    tone: "tool",
    sequence,
    summary: `Ran ${command}`,
    payload: { detail: `Bash: {"command":${JSON.stringify(command)}}` },
  });
}

describe("deriveTimelineRows", () => {
  it("interleaves messages and activities by timestamp", () => {
    const first = nextIso();
    const middle = nextIso();
    const last = nextIso();
    const rows = deriveTimelineRows({
      ...empty,
      messages: [
        message({ id: "m1", role: "user", text: "go", createdAt: first }),
        message({ id: "m2", role: "assistant", text: "done", createdAt: last }),
      ],
      activities: [activity({ id: "a1", kind: "session.started", sequence: 1, createdAt: middle })],
    });
    expect(kinds(rows)).toEqual(["user-message", "activity", "assistant-message"]);
  });

  it("collapses a contiguous run of tool calls into one group", () => {
    const rows = deriveTimelineRows({
      ...empty,
      activities: [
        toolActivity("t1", 1, "bun test"),
        toolActivity("t2", 2, "bun lint"),
        toolActivity("t3", 3, "bun fmt"),
      ],
    });
    expect(kinds(rows)).toEqual(["tool-group"]);
    const group = rows[0];
    if (group?.kind !== "tool-group") throw new Error("expected a tool group");
    expect(group.entries).toHaveLength(3);
    expect(group.summary?.label).toBe("Ran 3 commands");
  });

  it("splits tool groups around a non-tool activity", () => {
    const rows = deriveTimelineRows({
      ...empty,
      activities: [
        toolActivity("t1", 1, "bun test"),
        activity({ id: "n1", kind: "runtime.warning", tone: "info", sequence: 2 }),
        toolActivity("t2", 3, "bun lint"),
      ],
    });
    expect(kinds(rows)).toEqual(["tool-group", "activity", "tool-group"]);
    // A one-entry run stays expanded: there is nothing worth folding away.
    const first = rows[0];
    if (first?.kind !== "tool-group") throw new Error("expected a tool group");
    expect(first.summary).toBeNull();
  });

  it("routes error-tone activities to error rows", () => {
    const rows = deriveTimelineRows({
      ...empty,
      activities: [
        activity({
          id: "e1",
          kind: "provider.turn.start.failed",
          tone: "error",
          sequence: 1,
          summary: "Provider credentials missing",
        }),
      ],
    });
    expect(kinds(rows)).toEqual(["error"]);
  });

  it("hides approval bookkeeping activities (the composer card owns them)", () => {
    const rows = deriveTimelineRows({
      ...empty,
      activities: [
        activity({ id: "a1", kind: "approval.requested", tone: "approval", sequence: 1 }),
        activity({ id: "a2", kind: "approval.resolved", tone: "approval", sequence: 2 }),
        activity({ id: "a3", kind: "user-input.requested", tone: "approval", sequence: 3 }),
      ],
    });
    expect(rows).toHaveLength(0);
  });

  it("hides the per-turn session telemetry a real turn emits", () => {
    // Exactly the activity kinds observed for a one-word reply against the dev
    // server (scripts/smoke-thread.ts).
    const rows = deriveTimelineRows({
      ...empty,
      activities: [
        activity({ id: "b1", kind: "context-window.configured", sequence: 1 }),
        activity({ id: "b2", kind: "account.rate-limits.updated", sequence: 2 }),
        activity({ id: "b3", kind: "context-window.updated", sequence: 3 }),
        activity({ id: "b4", kind: "turn.completed", sequence: 4 }),
        activity({ id: "b5", kind: "checkpoint.captured", sequence: 5 }),
      ],
    });
    expect(rows).toHaveLength(0);
  });

  it("still surfaces a real failure activity", () => {
    const rows = deriveTimelineRows({
      ...empty,
      activities: [
        activity({
          id: "c1",
          kind: "provider.turn.interrupt.failed",
          tone: "error",
          sequence: 1,
          summary: "Provider turn interrupt failed",
        }),
      ],
    });
    expect(kinds(rows)).toEqual(["error"]);
  });

  it("skips an assistant message that is still streaming with no text yet", () => {
    const rows = deriveTimelineRows({
      ...empty,
      messages: [
        message({ id: "m1", role: "assistant", text: "", streaming: true, turnId: "turn-1" }),
      ],
    });
    expect(rows).toHaveLength(0);
  });

  it("hides system messages and empty checkpoints", () => {
    const rows = deriveTimelineRows({
      ...empty,
      messages: [message({ id: "m1", role: "system", text: "preamble" })],
      checkpoints: [
        {
          turnId: "turn-1",
          checkpointTurnCount: 1,
          checkpointRef: "ref",
          status: "ready",
          files: [],
          assistantMessageId: null,
          completedAt: nextIso(),
        },
      ] as never,
    });
    expect(rows).toHaveLength(0);
  });

  it("renders a checkpoint marker when the turn touched files", () => {
    const rows = deriveTimelineRows({
      ...empty,
      checkpoints: [
        {
          turnId: "turn-1",
          checkpointTurnCount: 1,
          checkpointRef: "ref",
          status: "ready",
          files: [{ path: "a.ts", kind: "modified", additions: 3, deletions: 1 }],
          assistantMessageId: null,
          completedAt: nextIso(),
        },
      ] as never,
    });
    expect(kinds(rows)).toEqual(["checkpoint"]);
  });
});

describe("tool-call classification", () => {
  it("derives verbs from the command so reads and searches group separately", () => {
    expect(deriveCommandDisplay("cat src/index.ts").verb).toBe("Read");
    expect(deriveCommandDisplay("rg --files src").verb).toBe("Searched");
    expect(deriveCommandDisplay("bun test", true).verb).toBe("Running");
    expect(deriveCommandDisplay("git status").target).toBe("git status");
  });

  it("summarizes a mixed run with the desktop vocabulary", () => {
    const entries = [
      toolEntryFromActivity(toolActivity("t1", 1, "bun test")),
      toolEntryFromActivity(toolActivity("t2", 2, "cat a.ts")),
      toolEntryFromActivity(toolActivity("t3", 3, "cat b.ts")),
      toolEntryFromActivity(
        activity({
          id: "t4",
          kind: "tool.completed",
          tone: "tool",
          sequence: 4,
          summary: "Edited file",
          payload: { requestKind: "file-change", detail: 'Edit: {"file_path":"c.ts"}' },
        }),
      ),
    ];
    expect(entries.map(classifyToolEntry)).toEqual(["command", "read", "read", "edit"]);
    const summary = summarizeToolEntries(entries);
    expect(summary?.label).toBe("Ran 1 command · Edited 1 file · Read 2 files");
    expect(summary?.entryCount).toBe(4);
  });

  it("counts distinct files, not distinct calls, for reads and edits", () => {
    const entries = [
      toolEntryFromActivity(toolActivity("t1", 1, "cat a.ts")),
      toolEntryFromActivity(toolActivity("t2", 2, "cat a.ts")),
    ];
    expect(summarizeToolEntries(entries)?.label).toBe("Read 1 file");
  });

  it("reports running and failed entries so a group never reads as settled", () => {
    const entries = [
      toolEntryFromActivity(toolActivity("t1", 1, "bun test", "tool.started")),
      toolEntryFromActivity(
        activity({
          id: "t2",
          kind: "tool.completed",
          tone: "tool",
          sequence: 2,
          summary: "Ran bun lint",
          payload: { status: "failed", detail: 'Bash: {"command":"bun lint"}' },
        }),
      ),
    ];
    const summary = summarizeToolEntries(entries);
    expect(summary?.hasRunningEntry).toBe(true);
    expect(summary?.hasFailedEntry).toBe(true);
  });

  it("refuses to summarize a single entry", () => {
    expect(
      summarizeToolEntries([toolEntryFromActivity(toolActivity("t1", 1, "bun test"))]),
    ).toBeNull();
  });
});
