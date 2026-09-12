// FILE: threadRows.ts
// Purpose: Turn the shell projection into the grouped, sorted, filtered rows the list renders.
// Layer: Mobile shell feature
// Exports: ThreadRow, ThreadSection, toThreadRow, sortThreadRows, buildThreadSections,
//          UNASSIGNED_PROJECT_ID.
//
// Pure: no React, no React Native, no store. The screen only maps the result to
// components, so the ordering rules are unit-testable on their own.

import {
  deriveThreadStatus,
  isAttentionStatus,
  threadStatusRank,
  type ThreadStatus,
  type ThreadStatusInput,
} from "./threadStatus";
import { formatRelativeTime } from "./relativeTime";

/** Threads whose project is not in the snapshot land in this synthetic group. */
export const UNASSIGNED_PROJECT_ID = "__unassigned__";

/** The subset of `OrchestrationThreadShell` the list actually reads. */
export interface ThreadShellView extends ThreadStatusInput {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly branch: string | null;
  readonly updatedAt: string;
  readonly archivedAt?: string | null | undefined;
  readonly isPinned?: boolean | undefined;
}

/** The subset of `OrchestrationProjectShell` the list actually reads. */
export interface ProjectShellView {
  readonly id: string;
  readonly title: string;
  readonly isPinned?: boolean | undefined;
}

export interface ThreadRow {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: ThreadStatus;
  readonly needsAttention: boolean;
  readonly branch: string | null;
  readonly updatedAt: string;
  readonly relativeTime: string;
  readonly isPinned: boolean;
}

export interface ThreadSection {
  readonly id: string;
  readonly title: string;
  readonly collapsed: boolean;
  readonly threadCount: number;
  readonly attentionCount: number;
  /** Empty while collapsed, so SectionList stops rendering the rows entirely. */
  readonly data: readonly ThreadRow[];
}

export function toThreadRow(thread: ThreadShellView, nowMs: number): ThreadRow {
  const status = deriveThreadStatus(thread);
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    status,
    needsAttention: isAttentionStatus(status),
    branch: thread.branch,
    updatedAt: thread.updatedAt,
    relativeTime: formatRelativeTime(thread.updatedAt, nowMs),
    isPinned: thread.isPinned === true,
  };
}

function updatedAtMs(row: ThreadRow): number {
  const parsed = Date.parse(row.updatedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Attention first, then running, then most recently updated. Ties break on id
 * so the order is total: an unstable tail would reshuffle rows on every live
 * shell event.
 */
export function sortThreadRows(rows: readonly ThreadRow[]): ThreadRow[] {
  // `toSorted` is ES2023: sorting a copy is equivalent and does not depend on
  // Hermes's array-method vintage.
  // oxlint-disable-next-line unicorn/no-array-sort
  return [...rows].sort((left, right) => {
    const byStatus = threadStatusRank(left.status) - threadStatusRank(right.status);
    if (byStatus !== 0) return byStatus;
    const byUpdatedAt = updatedAtMs(right) - updatedAtMs(left);
    if (byUpdatedAt !== 0) return byUpdatedAt;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

function matchesQuery(row: ThreadRow, projectTitle: string, needle: string): boolean {
  if (needle === "") return true;
  return (
    row.title.toLowerCase().includes(needle) ||
    projectTitle.toLowerCase().includes(needle) ||
    (row.branch?.toLowerCase().includes(needle) ?? false)
  );
}

export interface BuildThreadSectionsInput {
  readonly threads: readonly ThreadShellView[];
  readonly projects: readonly ProjectShellView[];
  readonly showArchived: boolean;
  readonly query: string;
  readonly collapsedProjectIds: readonly string[];
  readonly nowMs: number;
}

export interface BuildThreadSectionsResult {
  readonly sections: readonly ThreadSection[];
  /** Rows that survived filtering, across every section — drives the empty state. */
  readonly visibleThreadCount: number;
  readonly attentionCount: number;
}

export function buildThreadSections(input: BuildThreadSectionsInput): BuildThreadSectionsResult {
  const needle = input.query.trim().toLowerCase();
  const collapsed = new Set(input.collapsedProjectIds);

  const projectTitleById = new Map<string, string>();
  for (const project of input.projects) projectTitleById.set(project.id, project.title);

  const rowsByProject = new Map<string, ThreadRow[]>();
  let visibleThreadCount = 0;
  let attentionCount = 0;

  for (const thread of input.threads) {
    if (!input.showArchived && thread.archivedAt != null) continue;
    const row = toThreadRow(thread, input.nowMs);
    const groupId = projectTitleById.has(row.projectId) ? row.projectId : UNASSIGNED_PROJECT_ID;
    const projectTitle = projectTitleById.get(groupId) ?? "Other";
    if (!matchesQuery(row, projectTitle, needle)) continue;
    const bucket = rowsByProject.get(groupId);
    if (bucket) bucket.push(row);
    else rowsByProject.set(groupId, [row]);
    visibleThreadCount += 1;
    if (row.needsAttention) attentionCount += 1;
  }

  // Pinned projects first, then the snapshot's own order — which is the order
  // the web sidebar shows, so the two clients agree. A partition rather than a
  // sort: it is stable by construction and needs no comparator.
  const ordered = [
    ...input.projects.filter((project) => project.isPinned === true),
    ...input.projects.filter((project) => project.isPinned !== true),
  ];

  const sections: ThreadSection[] = [];
  for (const project of ordered) {
    const rows = rowsByProject.get(project.id) ?? [];
    // While searching, a project with no hit is noise; otherwise an empty
    // project is real information ("this project has no threads yet").
    if (rows.length === 0 && needle !== "") continue;
    const isCollapsed = collapsed.has(project.id);
    sections.push({
      id: project.id,
      title: project.title,
      collapsed: isCollapsed,
      threadCount: rows.length,
      attentionCount: rows.filter((row) => row.needsAttention).length,
      data: isCollapsed ? [] : sortThreadRows(rows),
    });
  }

  const orphans = rowsByProject.get(UNASSIGNED_PROJECT_ID) ?? [];
  if (orphans.length > 0) {
    const isCollapsed = collapsed.has(UNASSIGNED_PROJECT_ID);
    sections.push({
      id: UNASSIGNED_PROJECT_ID,
      title: "Other",
      collapsed: isCollapsed,
      threadCount: orphans.length,
      attentionCount: orphans.filter((row) => row.needsAttention).length,
      data: isCollapsed ? [] : sortThreadRows(orphans),
    });
  }

  return { sections, visibleThreadCount, attentionCount };
}
