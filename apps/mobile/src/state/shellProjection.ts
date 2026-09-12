// FILE: shellProjection.ts
// Purpose: Fold shell stream items into a flat projects/threads view model.
// Layer: Mobile state
// Exports: ShellProjection, emptyShellProjection, applyShellItem.
//
// Pure and dependency-free so it can be unit-tested and reused by any host.

import type {
  OrchestrationProjectShell,
  OrchestrationShellStreamItem,
  OrchestrationThreadShell,
} from "@synara/contracts";

export interface ShellProjection {
  readonly snapshotSequence: number;
  readonly projects: readonly OrchestrationProjectShell[];
  readonly threads: readonly OrchestrationThreadShell[];
}

export const emptyShellProjection: ShellProjection = {
  snapshotSequence: 0,
  projects: [],
  threads: [],
};

function upsertById<T extends { readonly id: string }>(list: readonly T[], next: T): T[] {
  const index = list.findIndex((entry) => entry.id === next.id);
  if (index === -1) return [...list, next];
  const copy = [...list];
  copy[index] = next;
  return copy;
}

export function applyShellItem(
  projection: ShellProjection,
  item: OrchestrationShellStreamItem,
): ShellProjection {
  switch (item.kind) {
    case "snapshot":
      return {
        snapshotSequence: item.snapshot.snapshotSequence,
        projects: item.snapshot.projects,
        threads: item.snapshot.threads,
      };
    case "project-upserted":
      return { ...projection, projects: upsertById(projection.projects, item.project) };
    case "project-removed":
      return {
        ...projection,
        projects: projection.projects.filter((project) => project.id !== item.projectId),
        threads: projection.threads.filter((thread) => thread.projectId !== item.projectId),
      };
    case "thread-upserted":
      return { ...projection, threads: upsertById(projection.threads, item.thread) };
    case "thread-removed":
      return {
        ...projection,
        threads: projection.threads.filter((thread) => thread.id !== item.threadId),
      };
    default:
      // space-* items carry no data this screen renders yet.
      return projection;
  }
}
