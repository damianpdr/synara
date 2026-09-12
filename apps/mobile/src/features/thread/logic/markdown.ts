// FILE: markdown.ts
// Purpose: Convert GFM markdown into a flat, RN-renderable block model.
// Layer: Mobile thread logic
// Exports: MarkdownBlock and its variants, InlineNode, parseMarkdownBlocks.
//
// Why a custom model instead of react-native-markdown-display: the fenced code
// block needs a horizontal ScrollView plus a copy button, tables need a
// measured column layout, and `exactOptionalPropertyTypes` makes the untyped
// renderer-rule objects those libraries use painful. `marked` is pure JS with
// first-party types, so lexing here and rendering with RN primitives keeps the
// whole path typed and unit-testable without a React Native test environment.
//
// This module is intentionally free of React and React Native imports.

import { marked, type Token, type Tokens } from "marked";

export interface InlineText {
  readonly kind: "text";
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly strikethrough: boolean;
  readonly code: boolean;
  /** Absolute or relative href; the renderer opens it with `Linking`. */
  readonly href: string | null;
}

export type InlineNode = InlineText;

export interface ParagraphBlock {
  readonly kind: "paragraph";
  readonly nodes: readonly InlineNode[];
}

export interface HeadingBlock {
  readonly kind: "heading";
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly nodes: readonly InlineNode[];
}

export interface CodeBlock {
  readonly kind: "code";
  readonly language: string | null;
  readonly text: string;
}

export interface ListItemModel {
  readonly nodes: readonly InlineNode[];
  /** null when the item carries no task checkbox. */
  readonly checked: boolean | null;
  /** Nested content, already flattened into blocks. */
  readonly children: readonly MarkdownBlock[];
}

export interface ListBlock {
  readonly kind: "list";
  readonly ordered: boolean;
  readonly start: number;
  readonly items: readonly ListItemModel[];
}

export interface BlockquoteBlock {
  readonly kind: "blockquote";
  readonly blocks: readonly MarkdownBlock[];
}

export interface TableBlock {
  readonly kind: "table";
  readonly header: readonly (readonly InlineNode[])[];
  readonly rows: readonly (readonly (readonly InlineNode[])[])[];
}

export interface RuleBlock {
  readonly kind: "rule";
}

export type MarkdownBlock =
  | ParagraphBlock
  | HeadingBlock
  | CodeBlock
  | ListBlock
  | BlockquoteBlock
  | TableBlock
  | RuleBlock;

interface InlineStyle {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly strikethrough: boolean;
  readonly code: boolean;
  readonly href: string | null;
}

const PLAIN: InlineStyle = {
  bold: false,
  italic: false,
  strikethrough: false,
  code: false,
  href: null,
};

function push(nodes: InlineText[], text: string, style: InlineStyle): void {
  if (text.length === 0) return;
  const previous = nodes.at(-1);
  // Adjacent runs with identical styling merge so the renderer emits one <Text>.
  if (
    previous !== undefined &&
    previous.bold === style.bold &&
    previous.italic === style.italic &&
    previous.strikethrough === style.strikethrough &&
    previous.code === style.code &&
    previous.href === style.href
  ) {
    nodes[nodes.length - 1] = { ...previous, text: `${previous.text}${text}` };
    return;
  }
  nodes.push({ kind: "text", text, ...style });
}

function collectInline(
  tokens: readonly Token[] | undefined,
  style: InlineStyle,
  out: InlineText[],
): void {
  if (tokens === undefined) return;
  for (const token of tokens) {
    switch (token.type) {
      case "text":
      case "escape": {
        const textToken = token as Tokens.Text;
        // A `text` token can itself hold inline children (e.g. inside a list item).
        if (textToken.tokens !== undefined && textToken.tokens.length > 0) {
          collectInline(textToken.tokens, style, out);
        } else {
          push(out, decodeEntities(textToken.text), style);
        }
        break;
      }
      case "strong":
        collectInline((token as Tokens.Strong).tokens, { ...style, bold: true }, out);
        break;
      case "em":
        collectInline((token as Tokens.Em).tokens, { ...style, italic: true }, out);
        break;
      case "del":
        collectInline((token as Tokens.Del).tokens, { ...style, strikethrough: true }, out);
        break;
      case "codespan":
        push(out, decodeEntities((token as Tokens.Codespan).text), { ...style, code: true });
        break;
      case "link": {
        const link = token as Tokens.Link;
        collectInline(link.tokens, { ...style, href: link.href }, out);
        break;
      }
      case "image": {
        // No image loading in v1; the alt text keeps the sentence readable.
        const image = token as Tokens.Image;
        push(out, image.text.length > 0 ? `[image: ${image.text}]` : "[image]", style);
        break;
      }
      case "br":
        push(out, "\n", style);
        break;
      case "html":
        // Raw HTML has no renderer here; showing the source beats dropping content.
        push(out, (token as Tokens.HTML).raw, style);
        break;
      default: {
        const raw = (token as { raw?: unknown }).raw;
        if (typeof raw === "string") push(out, decodeEntities(raw), style);
      }
    }
  }
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/gu, (match) => ENTITIES[match] ?? match);
}

function inlineFrom(
  tokens: readonly Token[] | undefined,
  fallback?: string,
): readonly InlineNode[] {
  const out: InlineText[] = [];
  collectInline(tokens, PLAIN, out);
  if (out.length === 0 && fallback !== undefined && fallback.length > 0) {
    push(out, decodeEntities(fallback), PLAIN);
  }
  return out;
}

function inlineFromText(text: string): readonly InlineNode[] {
  return inlineFrom(marked.lexer(text, { gfm: true }).flatMap(flattenForInline), text);
}

function flattenForInline(token: Token): Token[] {
  return token.type === "paragraph" ? ((token as Tokens.Paragraph).tokens ?? []) : [token];
}

function convertTokens(tokens: readonly Token[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "space":
        break;
      case "heading": {
        const heading = token as Tokens.Heading;
        const level = Math.min(6, Math.max(1, heading.depth)) as HeadingBlock["level"];
        blocks.push({ kind: "heading", level, nodes: inlineFrom(heading.tokens, heading.text) });
        break;
      }
      case "paragraph": {
        const paragraph = token as Tokens.Paragraph;
        const nodes = inlineFrom(paragraph.tokens, paragraph.text);
        if (nodes.length > 0) blocks.push({ kind: "paragraph", nodes });
        break;
      }
      case "code": {
        const code = token as Tokens.Code;
        const language = code.lang?.trim().split(/\s+/u)[0] ?? "";
        blocks.push({
          kind: "code",
          language: language.length > 0 ? language : null,
          text: code.text,
        });
        break;
      }
      case "blockquote": {
        const quote = token as Tokens.Blockquote;
        blocks.push({ kind: "blockquote", blocks: convertTokens(quote.tokens ?? []) });
        break;
      }
      case "list": {
        const list = token as Tokens.List;
        blocks.push({
          kind: "list",
          ordered: list.ordered,
          start: typeof list.start === "number" ? list.start : 1,
          items: list.items.map((item) => convertListItem(item)),
        });
        break;
      }
      case "table": {
        const table = token as Tokens.Table;
        blocks.push({
          kind: "table",
          header: table.header.map((cell) => inlineFrom(cell.tokens, cell.text)),
          rows: table.rows.map((row) => row.map((cell) => inlineFrom(cell.tokens, cell.text))),
        });
        break;
      }
      case "hr":
        blocks.push({ kind: "rule" });
        break;
      case "html": {
        const html = token as Tokens.HTML;
        const text = html.raw.trim();
        if (text.length > 0) blocks.push({ kind: "paragraph", nodes: inlineFromText(text) });
        break;
      }
      case "text": {
        const text = token as Tokens.Text;
        const nodes =
          text.tokens !== undefined && text.tokens.length > 0
            ? inlineFrom(text.tokens, text.text)
            : inlineFromText(text.text);
        if (nodes.length > 0) blocks.push({ kind: "paragraph", nodes });
        break;
      }
      default:
        break;
    }
  }
  return blocks;
}

function convertListItem(item: Tokens.ListItem): ListItemModel {
  // A list item's first paragraph/text token is the item's own line; anything
  // after it (nested lists, code fences) becomes child blocks.
  const tokens = item.tokens ?? [];
  const leadIndex = tokens.findIndex(
    (token) => token.type === "text" || token.type === "paragraph",
  );
  const lead = leadIndex === -1 ? undefined : tokens[leadIndex];
  const leadTokens =
    lead === undefined ? undefined : ((lead as Tokens.Text | Tokens.Paragraph).tokens ?? undefined);
  const rest = tokens.filter((_, index) => index !== leadIndex);
  return {
    nodes: inlineFrom(leadTokens, (lead as Tokens.Text | undefined)?.text ?? item.text),
    checked: item.task ? item.checked === true : null,
    children: convertTokens(rest),
  };
}

/**
 * Lexes GFM markdown into the block model. Never throws: a lexer failure on
 * partial streamed text falls back to one plain paragraph so a half-arrived
 * assistant message still renders.
 */
export function parseMarkdownBlocks(markdown: string): readonly MarkdownBlock[] {
  if (markdown.trim().length === 0) return [];
  try {
    return convertTokens(marked.lexer(markdown, { gfm: true, breaks: true }));
  } catch {
    return [{ kind: "paragraph", nodes: [{ kind: "text", text: markdown, ...PLAIN }] }];
  }
}
