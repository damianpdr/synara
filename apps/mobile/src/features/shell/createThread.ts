// FILE: createThread.ts
// Purpose: Build and dispatch the `thread.create` command for the "+" button.
// Layer: Mobile shell feature
// Exports: pickThreadDefaults, buildThreadCreateCommand, DEFAULT_MODEL_SELECTION,
//          DEFAULT_RUNTIME_MODE, NEW_THREAD_TITLE.
//
// Field list verified against `ClientThreadCreateCommand` in
// packages/contracts/src/orchestration.ts (~line 1096). Required: type,
// commandId, threadId, projectId, title, modelSelection, runtimeMode, branch,
// worktreePath, createdAt. `interactionMode` and `envMode` have decoding
// defaults ("default" / "local") and are therefore omitted rather than guessed.
// A working reference dispatch lives in apps/mobile-dev/seed.ts.

import type { ClientOrchestrationCommand, ModelSelection, RuntimeMode } from "@synara/contracts";

/**
 * Last-resort defaults, used only when the server has no thread and the project
 * has no `defaultModelSelection` — i.e. a brand new install. Claude Sonnet with
 * approvals required is the conservative choice: a phone is the worst place to
 * discover an agent ran unattended. Matches apps/mobile-dev/seed.ts.
 */
export const DEFAULT_MODEL_SELECTION: ModelSelection = {
  provider: "claudeAgent",
  model: "claude-sonnet-5",
};

/**
 * NOT `contracts`' `DEFAULT_RUNTIME_MODE` ("full-access"): that default exists
 * so old persisted rows decode, not as a recommendation for a new thread
 * started from a phone.
 */
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "approval-required";

export const NEW_THREAD_TITLE = "New thread";

/** The subset of a shell thread row the defaults are copied from. */
export interface ThreadDefaultsSource {
  readonly projectId: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly updatedAt: string;
  readonly archivedAt?: string | null | undefined;
}

export interface ProjectDefaultsSource {
  readonly id: string;
  readonly defaultModelSelection: ModelSelection | null;
}

export interface ThreadDefaults {
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
}

function newest(threads: readonly ThreadDefaultsSource[]): ThreadDefaultsSource | undefined {
  let best: ThreadDefaultsSource | undefined;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const thread of threads) {
    if (thread.archivedAt != null) continue;
    const ms = Date.parse(thread.updatedAt);
    const value = Number.isNaN(ms) ? 0 : ms;
    if (value > bestMs) {
      bestMs = value;
      best = thread;
    }
  }
  return best;
}

/**
 * Model + runtime mode for a new thread, in descending order of "the user
 * already told us this":
 *   1. the most recently updated thread in the target project
 *   2. the project's own `defaultModelSelection` (what the web new-thread
 *      composer pre-selects)
 *   3. the most recently updated thread anywhere
 *   4. the documented fallback above
 * Runtime mode never comes from a project (projects do not carry one), so it
 * falls back from thread to thread to `approval-required`.
 */
export function pickThreadDefaults(input: {
  readonly projectId: string;
  readonly threads: readonly ThreadDefaultsSource[];
  readonly projects: readonly ProjectDefaultsSource[];
}): ThreadDefaults {
  const inProject = newest(input.threads.filter((thread) => thread.projectId === input.projectId));
  if (inProject) {
    return { modelSelection: inProject.modelSelection, runtimeMode: inProject.runtimeMode };
  }
  const anywhere = newest(input.threads);
  const projectDefault =
    input.projects.find((project) => project.id === input.projectId)?.defaultModelSelection ?? null;
  return {
    modelSelection: projectDefault ?? anywhere?.modelSelection ?? DEFAULT_MODEL_SELECTION,
    runtimeMode: anywhere?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
  };
}

/**
 * The wire (encoded) shape of `thread.create`: exactly the required fields plus
 * `interactionMode`, which is cheap to be explicit about. Every other field on
 * the schema carries a decoding default, so omitting them is what the server
 * expects.
 */
interface ThreadCreateWireCommand {
  readonly type: "thread.create";
  readonly commandId: string;
  readonly threadId: string;
  readonly projectId: string;
  readonly title: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: "default";
  readonly branch: null;
  readonly worktreePath: null;
  readonly createdAt: string;
}

export function buildThreadCreateCommand(input: {
  readonly commandId: string;
  readonly threadId: string;
  readonly projectId: string;
  readonly title?: string;
  readonly defaults: ThreadDefaults;
  readonly createdAt: string;
}): ClientOrchestrationCommand {
  const command: ThreadCreateWireCommand = {
    type: "thread.create",
    commandId: input.commandId,
    threadId: input.threadId,
    projectId: input.projectId,
    title: input.title ?? NEW_THREAD_TITLE,
    modelSelection: input.defaults.modelSelection,
    runtimeMode: input.defaults.runtimeMode,
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt: input.createdAt,
  };
  // `ClientOrchestrationCommand` is the *decoded* type: its optional-with-
  // default fields (envMode, isPinned, parentThreadId, sidechat*, ...) are
  // required there, while the wire accepts them missing. The transport only
  // JSON-serialises this value, so the encoded shape is the correct one to
  // send and the cast is the boundary between the two views of one schema.
  return command as unknown as ClientOrchestrationCommand;
}
