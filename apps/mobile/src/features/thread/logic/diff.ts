// FILE: diff.ts
// Purpose: Split a unified diff into per-file sections with typed lines.
// Layer: Mobile thread logic
// Exports: DiffLineKind, DiffLine, DiffFileSection, parseUnifiedDiff.
//
// No dependency on a diff library: the sheet is read-only plain text with +/-
// colouring, so classifying lines by their first character is the whole job.

export type DiffLineKind = "add" | "remove" | "hunk" | "meta" | "context";

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly text: string;
}

export interface DiffFileSection {
  /** Display path: the `b/` side of the header, falling back to the `a/` side. */
  readonly path: string;
  readonly lines: readonly DiffLine[];
  readonly additions: number;
  readonly deletions: number;
}

function classify(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  if (
    line.startsWith("diff ") ||
    line.startsWith("index ") ||
    line.startsWith("new file") ||
    line.startsWith("deleted file") ||
    line.startsWith("similarity index") ||
    line.startsWith("rename ") ||
    line.startsWith("old mode") ||
    line.startsWith("new mode") ||
    line.startsWith("Binary files")
  ) {
    return "meta";
  }
  return "context";
}

/** `diff --git a/path/to/file b/path/to/file` → `path/to/file`. */
function pathFromGitHeader(line: string): string | null {
  const match = /^diff --git a\/(.+?) b\/(.+)$/u.exec(line);
  if (match) return match[2] ?? match[1] ?? null;
  return null;
}

function pathFromUnifiedHeader(line: string): string | null {
  const match = /^\+\+\+ (?:b\/)?(.+)$/u.exec(line);
  const path = match?.[1]?.trim();
  if (path === undefined || path.length === 0 || path === "/dev/null") return null;
  return path;
}

export function parseUnifiedDiff(diff: string): readonly DiffFileSection[] {
  if (diff.trim().length === 0) return [];
  const sections: DiffFileSection[] = [];
  let path: string | null = null;
  let lines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;

  const flush = (): void => {
    if (lines.length === 0) return;
    sections.push({ path: path ?? "(unnamed)", lines, additions, deletions });
    lines = [];
    additions = 0;
    deletions = 0;
  };

  for (const raw of diff.split("\n")) {
    const gitPath = pathFromGitHeader(raw);
    if (gitPath !== null) {
      flush();
      path = gitPath;
      lines.push({ kind: "meta", text: raw });
      continue;
    }
    const kind = classify(raw);
    // A bare unified diff (no `diff --git` preamble) starts each file at `+++`.
    if (kind === "meta" && raw.startsWith("+++")) {
      const unifiedPath = pathFromUnifiedHeader(raw);
      if (unifiedPath !== null && path === null) path = unifiedPath;
    }
    if (kind === "add") additions += 1;
    if (kind === "remove") deletions += 1;
    lines.push({ kind, text: raw });
  }
  flush();
  return sections;
}
