import { describe, expect, it } from "vitest";

import {
  buildThreadSections,
  sortThreadRows,
  toThreadRow,
  UNASSIGNED_PROJECT_ID,
  type ProjectShellView,
  type ThreadShellView,
} from "./threadRows";

const NOW = Date.parse("2025-06-15T12:00:00.000Z");

const thread = (overrides: Partial<ThreadShellView> & { id: string }): ThreadShellView => ({
  projectId: "p1",
  title: `Thread ${overrides.id}`,
  branch: null,
  updatedAt: "2025-06-15T11:00:00.000Z",
  latestTurn: null,
  session: null,
  ...overrides,
});

const project = (id: string, title: string, isPinned = false): ProjectShellView => ({
  id,
  title,
  isPinned,
});

const build = (
  threads: readonly ThreadShellView[],
  projects: readonly ProjectShellView[],
  overrides: Partial<Parameters<typeof buildThreadSections>[0]> = {},
) =>
  buildThreadSections({
    threads,
    projects,
    showArchived: false,
    query: "",
    collapsedProjectIds: [],
    nowMs: NOW,
    ...overrides,
  });

describe("toThreadRow", () => {
  it("projects status, branch and a relative time", () => {
    const row = toThreadRow(
      thread({
        id: "t1",
        branch: "feat/x",
        updatedAt: "2025-06-15T09:00:00.000Z",
        session: { status: "running" },
      }),
      NOW,
    );
    expect(row).toMatchObject({
      id: "t1",
      status: "running",
      needsAttention: false,
      branch: "feat/x",
      relativeTime: "3h",
      isPinned: false,
    });
  });

  it("flags attention statuses", () => {
    expect(toThreadRow(thread({ id: "t1", hasPendingApprovals: true }), NOW).needsAttention).toBe(
      true,
    );
  });
});

describe("sortThreadRows", () => {
  it("puts attention first, then running, then newest", () => {
    const rows = [
      toThreadRow(thread({ id: "idle-old", updatedAt: "2025-06-01T00:00:00.000Z" }), NOW),
      toThreadRow(thread({ id: "idle-new", updatedAt: "2025-06-14T00:00:00.000Z" }), NOW),
      toThreadRow(thread({ id: "running", session: { status: "running" } }), NOW),
      toThreadRow(thread({ id: "input", hasPendingUserInput: true }), NOW),
      toThreadRow(thread({ id: "approve", hasPendingApprovals: true }), NOW),
    ];
    expect(sortThreadRows(rows).map((row) => row.id)).toEqual([
      "approve",
      "input",
      "running",
      "idle-new",
      "idle-old",
    ]);
  });

  it("breaks ties on id so live updates do not reshuffle equal rows", () => {
    const rows = [toThreadRow(thread({ id: "b" }), NOW), toThreadRow(thread({ id: "a" }), NOW)];
    expect(sortThreadRows(rows).map((row) => row.id)).toEqual(["a", "b"]);
    const swapped = [rows[1], rows[0]].filter((row) => row !== undefined);
    expect(sortThreadRows(swapped).map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("does not mutate its input", () => {
    const rows = [toThreadRow(thread({ id: "b" }), NOW), toThreadRow(thread({ id: "a" }), NOW)];
    sortThreadRows(rows);
    expect(rows.map((row) => row.id)).toEqual(["b", "a"]);
  });
});

describe("buildThreadSections", () => {
  const projects = [project("p1", "Synara"), project("p2", "Website")];

  it("groups threads under their project, pinned projects first", () => {
    const result = build(
      [thread({ id: "t1" }), thread({ id: "t2", projectId: "p2" })],
      [project("p1", "Synara"), project("p2", "Website", true)],
    );
    expect(result.sections.map((section) => section.title)).toEqual(["Website", "Synara"]);
    expect(result.visibleThreadCount).toBe(2);
  });

  it("keeps empty projects when browsing but drops them when searching", () => {
    expect(build([thread({ id: "t1" })], projects).sections).toHaveLength(2);
    expect(build([thread({ id: "t1" })], projects, { query: "Thread" }).sections).toHaveLength(1);
  });

  it("hides archived threads unless asked", () => {
    const threads = [
      thread({ id: "t1" }),
      thread({ id: "t2", archivedAt: "2025-06-01T00:00:00.000Z" }),
    ];
    expect(build(threads, projects).visibleThreadCount).toBe(1);
    expect(build(threads, projects, { showArchived: true }).visibleThreadCount).toBe(2);
  });

  it("matches the query against title, branch and project name", () => {
    const threads = [
      thread({ id: "t1", title: "Fix the parser" }),
      thread({ id: "t2", title: "Unrelated", branch: "feat/parser" }),
      thread({ id: "t3", title: "Unrelated", projectId: "p2" }),
    ];
    expect(build(threads, projects, { query: "parser" }).visibleThreadCount).toBe(2);
    expect(build(threads, projects, { query: "website" }).visibleThreadCount).toBe(1);
    expect(build(threads, projects, { query: "  PARSER " }).visibleThreadCount).toBe(2);
  });

  it("empties a collapsed section but keeps its counts", () => {
    const result = build(
      [thread({ id: "t1", hasPendingApprovals: true }), thread({ id: "t2" })],
      projects,
      { collapsedProjectIds: ["p1"] },
    );
    const [first] = result.sections;
    expect(first?.collapsed).toBe(true);
    expect(first?.data).toHaveLength(0);
    expect(first?.threadCount).toBe(2);
    expect(first?.attentionCount).toBe(1);
    expect(result.visibleThreadCount).toBe(2);
  });

  it("collects threads whose project is missing into a trailing Other group", () => {
    const result = build(
      [thread({ id: "t1" }), thread({ id: "t2", projectId: "ghost" })],
      projects,
    );
    const last = result.sections.at(-1);
    expect(last?.id).toBe(UNASSIGNED_PROJECT_ID);
    expect(last?.title).toBe("Other");
    expect(last?.data.map((row) => row.id)).toEqual(["t2"]);
  });

  it("counts threads needing attention across every section", () => {
    const result = build(
      [
        thread({ id: "t1", hasPendingApprovals: true }),
        thread({ id: "t2", projectId: "p2", hasPendingUserInput: true }),
        thread({ id: "t3", projectId: "p2" }),
      ],
      projects,
    );
    expect(result.attentionCount).toBe(2);
  });
});
