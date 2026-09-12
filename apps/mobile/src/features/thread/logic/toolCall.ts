// FILE: toolCall.ts
// Purpose: Turn raw thread activities into renderable tool-call rows, and fold a
//          run of them into one collapsed summary ("Ran 3 commands, edited 2 files").
// Layer: Mobile thread logic
// Exports: ToolEntry, ToolStatus, ToolCallCategory, ToolCallGroupSummary,
//          toolEntryFromActivity, deriveCommandDisplay, classifyToolEntry,
//          summarizeToolEntries, MIN_COLLAPSIBLE_TOOL_GROUP_SIZE.
//
// Ported and heavily trimmed from:
//   - apps/web/src/workLog.ts (toDerivedWorkLogEntry: payload extraction,
//     deriveToolLifecycleStatus)
//   - apps/web/src/components/chat/toolCallGroup.logic.ts (summarizeToolCallGroup)
//   - apps/web/src/lib/toolCallLabel.ts (deriveReadableCommandDisplay)
//   - apps/web/src/lib/toolArgumentSummary.ts (parseToolArgumentSummary)
//
// The web `WorkLogEntry` carries ~40 fields for surfaces the phone does not
// have (subagent strips, automation cards, live browser activity, task lists).
// This port keeps only what a one-line mobile row renders: a label, an argument
// summary, and a status. Same classification vocabulary, so the collapsed
// summary text reads identically to the desktop app.

import type { OrchestrationThreadActivity } from "@synara/contracts";

import {
  approvalRequestKindFromRequestType,
  type ApprovalRequestKind,
} from "./pendingInteractions";

export type ToolStatus = "running" | "completed" | "failed" | "cancelled";

export interface ToolEntry {
  readonly id: string;
  readonly createdAt: string;
  readonly sequence: number | undefined;
  readonly turnId: string | null;
  readonly activityKind: string;
  /** Human title: the provider summary, or a verb+target derived from a command. */
  readonly label: string;
  /** Secondary line: command text, file path, or the tool's argument summary. */
  readonly detail: string | null;
  readonly toolName: string | null;
  readonly command: string | null;
  readonly changedFiles: readonly string[];
  readonly requestKind: ApprovalRequestKind | null;
  readonly status: ToolStatus;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTrimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Activity kinds that represent a unit of provider tool work. */
const TOOL_LIFECYCLE_KINDS = new Set(["tool.started", "tool.updated", "tool.completed"]);

export function isToolLifecycleActivity(activity: OrchestrationThreadActivity): boolean {
  return activity.tone === "tool" || TOOL_LIFECYCLE_KINDS.has(activity.kind);
}

/** Ported from apps/web/src/workLog.ts::deriveToolLifecycleStatus. */
function deriveToolStatus(
  activityKind: string,
  payload: Record<string, unknown> | null,
): ToolStatus {
  const status = asTrimmed(payload?.status) ?? asTrimmed(asRecord(payload?.data)?.status);
  if (status !== null) {
    const normalized = status.toLowerCase();
    if (normalized === "failed" || normalized === "error") return "failed";
    if (normalized === "cancelled" || normalized === "canceled" || normalized === "aborted") {
      return "cancelled";
    }
  }
  if (payload?.isError === true || payload?.error != null) return "failed";
  return activityKind === "tool.completed" ? "completed" : "running";
}

/**
 * Providers report dynamic/MCP calls as `ToolName: {jsonArgs}`.
 * Ported from apps/web/src/lib/toolArgumentSummary.ts.
 */
function extractArgumentField(detail: string, keys: readonly string[]): string | null {
  const trimmed = detail.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const args = asRecord(JSON.parse(trimmed.slice(start, end + 1)) as unknown);
      if (args) {
        for (const key of keys) {
          const value = asTrimmed(args[key]);
          if (value !== null) return value;
        }
      }
    } catch {
      // Truncated stream JSON — fall through to the regex scan.
    }
  }
  const escaped = keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const match = new RegExp(`"(?:${escaped.join("|")})"\\s*:\\s*"([^"]+)"`, "i").exec(trimmed);
  return asTrimmed(match?.[1]);
}

function extractToolName(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  return (
    asTrimmed(payload?.toolName) ??
    asTrimmed(data?.toolName) ??
    asTrimmed(data?.tool) ??
    asTrimmed(item?.toolName) ??
    asTrimmed(item?.name)
  );
}

function extractCommand(
  payload: Record<string, unknown> | null,
  detail: string | null,
): string | null {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const input = asRecord(item?.input) ?? asRecord(data?.input);
  const direct =
    asTrimmed(payload?.command) ??
    asTrimmed(data?.command) ??
    asTrimmed(item?.command) ??
    asTrimmed(input?.command);
  if (direct !== null) return direct;
  return detail === null ? null : extractArgumentField(detail, ["command", "cmd"]);
}

function extractChangedFiles(
  payload: Record<string, unknown> | null,
  detail: string | null,
): string[] {
  const files = new Set<string>();
  const push = (value: unknown) => {
    const path = asTrimmed(value);
    if (path !== null) files.add(path);
  };
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const input = asRecord(item?.input) ?? asRecord(data?.input);
  for (const source of [payload, data, item, input]) {
    if (source === null) continue;
    push(source.filePath);
    push(source.file_path);
    push(source.path);
    push(source.notebook_path);
    const list = source.changedFiles ?? source.files ?? source.paths;
    if (Array.isArray(list)) {
      for (const entry of list) {
        push(typeof entry === "string" ? entry : asRecord(entry)?.path);
      }
    }
  }
  if (files.size === 0 && detail !== null) {
    push(extractArgumentField(detail, ["file_path", "path", "notebook_path", "filepath"]));
  }
  return [...files];
}

// --------------------------------------------------------- command labelling

export interface CommandDisplay {
  readonly verb: string;
  readonly target: string;
}

const READ_COMMAND_TOOLS = new Set(["cat", "head", "tail", "less", "more", "bat", "view"]);
const SEARCH_COMMAND_TOOLS = new Set(["grep", "rg", "ag", "ack", "egrep", "fgrep"]);
const LIST_COMMAND_TOOLS = new Set(["ls", "tree", "exa", "eza"]);
const FIND_COMMAND_TOOLS = new Set(["find", "fd"]);

function lastPathComponent(argument: string): string {
  const parts = argument.split("/").filter((part) => part.length > 0);
  return parts.at(-1) ?? argument;
}

/**
 * Ported (subset) from apps/web/src/lib/toolCallLabel.ts::deriveReadableCommandDisplay.
 * The web version humanizes ~40 shells and every git subcommand; the phone row
 * only needs the verb (which drives grouping) plus a short target.
 */
export function deriveCommandDisplay(rawCommand: string, isRunning = false): CommandDisplay {
  const command = rawCommand.trim().replace(/^(?:bash|sh|zsh)\s+-[a-z]+\s+/iu, "");
  // Only the first segment of a pipeline names the work.
  const primary = command.split(/\s*(?:&&|\|\||;|\|)\s*/u)[0] ?? command;
  const tokens = primary.split(/\s+/u).filter((token) => token.length > 0);
  // Strip any leading path so `/usr/bin/grep` classifies as `grep`.
  const tool = (tokens[0] ?? "").replace(/^.*\//u, "");
  // Flags never name the subject of the command; the first bare token does.
  const firstArg = tokens.slice(1).find((token) => !token.startsWith("-"));
  const compact = primary.length > 60 ? `${primary.slice(0, 57)}…` : primary;

  if (READ_COMMAND_TOOLS.has(tool)) {
    return { verb: isRunning ? "Reading" : "Read", target: lastPathComponent(firstArg ?? "file") };
  }
  if (SEARCH_COMMAND_TOOLS.has(tool)) {
    return { verb: isRunning ? "Searching" : "Searched", target: firstArg ?? "files" };
  }
  if (LIST_COMMAND_TOOLS.has(tool)) {
    return {
      verb: isRunning ? "Listing" : "Listed",
      target: lastPathComponent(firstArg ?? "directory"),
    };
  }
  if (FIND_COMMAND_TOOLS.has(tool)) {
    return { verb: isRunning ? "Finding" : "Found", target: firstArg ?? "files" };
  }
  if (tool === "git") {
    return { verb: isRunning ? "Running" : "Ran", target: `git ${firstArg ?? ""}`.trim() };
  }
  return { verb: isRunning ? "Running" : "Ran", target: compact };
}

// ------------------------------------------------------------------- mapping

export function toolEntryFromActivity(activity: OrchestrationThreadActivity): ToolEntry {
  const payload = asRecord(activity.payload);
  const detail = asTrimmed(payload?.detail);
  const command = extractCommand(payload, detail);
  const status = deriveToolStatus(activity.kind, payload);
  const requestKind =
    payload?.requestKind === "command" ||
    payload?.requestKind === "file-read" ||
    payload?.requestKind === "file-change" ||
    payload?.requestKind === "permissions"
      ? payload.requestKind
      : approvalRequestKindFromRequestType(payload?.requestType);
  const changedFiles = extractChangedFiles(payload, detail);

  // The provider summary is usually already readable ("Ran tests"). A bare
  // command payload is not, so derive a verb+target label for that case.
  const label =
    activity.summary.trim().length > 0
      ? activity.summary
      : command !== null
        ? (() => {
            const display = deriveCommandDisplay(command, status === "running");
            return `${display.verb} ${display.target}`.trim();
          })()
        : (extractToolName(payload) ?? activity.kind);

  return {
    id: activity.id,
    createdAt: activity.createdAt,
    sequence: activity.sequence,
    turnId: activity.turnId,
    activityKind: activity.kind,
    label,
    detail: command ?? changedFiles[0] ?? detail,
    toolName: extractToolName(payload),
    command,
    changedFiles,
    requestKind,
    status,
  };
}

// ------------------------------------------------------------------ grouping

export type ToolCallCategory = "command" | "edit" | "read" | "search" | "tool" | "other";

export interface ToolCallGroupSummaryPart {
  readonly category: ToolCallCategory;
  readonly count: number;
  readonly label: string;
}

export interface ToolCallGroupSummary {
  readonly label: string;
  readonly parts: readonly ToolCallGroupSummaryPart[];
  readonly entryCount: number;
  readonly hasRunningEntry: boolean;
  readonly hasFailedEntry: boolean;
}

/** A single tool row collapses into nothing useful; only runs of 2+ fold. */
export const MIN_COLLAPSIBLE_TOOL_GROUP_SIZE = 2;

const READ_VERBS = new Set(["Read", "Reading"]);
const SEARCH_VERBS = new Set(["Searched", "Searching", "Found", "Finding"]);

function classifyCommandVerb(verb: string): ToolCallCategory {
  if (READ_VERBS.has(verb)) return "read";
  if (SEARCH_VERBS.has(verb)) return "search";
  return "command";
}

/** Ported from apps/web/src/components/chat/toolCallGroup.logic.ts. */
export function classifyToolEntry(entry: ToolEntry): ToolCallCategory {
  if (entry.requestKind === "file-change") return "edit";
  if (entry.requestKind === "file-read") return "read";
  if (entry.command !== null) {
    return classifyCommandVerb(deriveCommandDisplay(entry.command).verb);
  }
  if (entry.changedFiles.length > 0) return "edit";
  if (entry.requestKind === "command") return "command";
  if (entry.toolName !== null) return "tool";
  // Structured provider actions carry the verb as the leading word of the label.
  const labelVerb = entry.label.trim().split(/\s+/u, 1)[0] ?? "";
  if (READ_VERBS.has(labelVerb) || SEARCH_VERBS.has(labelVerb)) {
    return classifyCommandVerb(labelVerb);
  }
  return "other";
}

/** Distinct-file identity for an edit/read entry; unattributed entries count as one. */
function entryFileKeys(entry: ToolEntry): readonly string[] {
  if (entry.changedFiles.length > 0) return entry.changedFiles;
  if (entry.command !== null) {
    const target = deriveCommandDisplay(entry.command).target.trim();
    if (target.length > 0) return [target];
  }
  return [];
}

const CATEGORY_ORDER: readonly ToolCallCategory[] = [
  "command",
  "edit",
  "read",
  "search",
  "tool",
  "other",
];

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function partLabel(category: ToolCallCategory, count: number, isSolePart: boolean): string {
  switch (category) {
    case "command":
      return `Ran ${count} ${plural(count, "command")}`;
    case "edit":
      return `Edited ${count} ${plural(count, "file")}`;
    case "read":
      return `Read ${count} ${plural(count, "file")}`;
    case "search":
      return `Searched ${count} ${plural(count, "file")}`;
    case "tool":
      return `Used ${count} ${plural(count, "tool")}`;
    case "other":
      return isSolePart
        ? `Ran ${count} tool ${plural(count, "call")}`
        : `${count} other tool ${plural(count, "call")}`;
  }
}

export function summarizeToolEntries(entries: readonly ToolEntry[]): ToolCallGroupSummary | null {
  if (entries.length < MIN_COLLAPSIBLE_TOOL_GROUP_SIZE) return null;

  const countByCategory = new Map<ToolCallCategory, number>();
  const distinctFilesByCategory = new Map<ToolCallCategory, Set<string>>();
  let hasRunningEntry = false;
  let hasFailedEntry = false;

  for (const entry of entries) {
    if (entry.status === "running") hasRunningEntry = true;
    if (entry.status === "failed") hasFailedEntry = true;
    const category = classifyToolEntry(entry);
    if (category === "edit" || category === "read") {
      const fileKeys = entryFileKeys(entry);
      if (fileKeys.length === 0) {
        countByCategory.set(category, (countByCategory.get(category) ?? 0) + 1);
        continue;
      }
      let distinct = distinctFilesByCategory.get(category);
      if (distinct === undefined) {
        distinct = new Set<string>();
        distinctFilesByCategory.set(category, distinct);
      }
      for (const fileKey of fileKeys) distinct.add(fileKey);
      continue;
    }
    countByCategory.set(category, (countByCategory.get(category) ?? 0) + 1);
  }

  for (const [category, distinct] of distinctFilesByCategory) {
    countByCategory.set(category, (countByCategory.get(category) ?? 0) + distinct.size);
  }

  const populated = CATEGORY_ORDER.filter((category) => (countByCategory.get(category) ?? 0) > 0);
  const parts = populated.map((category) => {
    const count = countByCategory.get(category) ?? 0;
    return { category, count, label: partLabel(category, count, populated.length === 1) };
  });

  return {
    label: parts.map((part) => part.label).join(" · "),
    parts,
    entryCount: entries.length,
    hasRunningEntry,
    hasFailedEntry,
  };
}
