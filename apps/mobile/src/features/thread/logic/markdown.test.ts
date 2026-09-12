// FILE: markdown.test.ts
// Purpose: GFM markdown lowers to the block model the RN renderer walks.
// Layer: Mobile thread logic (tests)

import { describe, expect, it } from "vitest";

import { parseMarkdownBlocks, type MarkdownBlock } from "./markdown";

function kinds(blocks: readonly MarkdownBlock[]): string[] {
  return blocks.map((block) => block.kind);
}

function plain(nodes: readonly { readonly text: string }[]): string {
  return nodes.map((node) => node.text).join("");
}

describe("parseMarkdownBlocks", () => {
  it("returns nothing for blank input", () => {
    expect(parseMarkdownBlocks("")).toEqual([]);
    expect(parseMarkdownBlocks("   \n\n ")).toEqual([]);
  });

  it("lowers headings with their level", () => {
    const blocks = parseMarkdownBlocks("# One\n\n### Three\n");
    expect(kinds(blocks)).toEqual(["heading", "heading"]);
    const [first, second] = blocks;
    if (first?.kind !== "heading" || second?.kind !== "heading")
      throw new Error("expected headings");
    expect(first.level).toBe(1);
    expect(second.level).toBe(3);
    expect(plain(first.nodes)).toBe("One");
  });

  it("carries bold, italic, strikethrough and inline code as node styles", () => {
    const blocks = parseMarkdownBlocks("**bold** _em_ ~~gone~~ `code`");
    const [paragraph] = blocks;
    if (paragraph?.kind !== "paragraph") throw new Error("expected a paragraph");
    const styled = Object.fromEntries(paragraph.nodes.map((node) => [node.text.trim(), node]));
    expect(styled.bold?.bold).toBe(true);
    expect(styled.em?.italic).toBe(true);
    expect(styled.gone?.strikethrough).toBe(true);
    expect(styled.code?.code).toBe(true);
  });

  it("keeps link hrefs on the text nodes so the renderer can open them", () => {
    const blocks = parseMarkdownBlocks("see [the docs](https://example.com/a)");
    const [paragraph] = blocks;
    if (paragraph?.kind !== "paragraph") throw new Error("expected a paragraph");
    const link = paragraph.nodes.find((node) => node.href !== null);
    expect(link?.href).toBe("https://example.com/a");
    expect(link?.text).toBe("the docs");
  });

  it("preserves fenced code verbatim with its language", () => {
    const blocks = parseMarkdownBlocks("```ts\nconst a = 1;\n  indented\n```");
    const [code] = blocks;
    if (code?.kind !== "code") throw new Error("expected a code block");
    expect(code.language).toBe("ts");
    expect(code.text).toBe("const a = 1;\n  indented");
  });

  it("treats an unlabelled fence as language-less", () => {
    const blocks = parseMarkdownBlocks("```\nplain\n```");
    const [code] = blocks;
    if (code?.kind !== "code") throw new Error("expected a code block");
    expect(code.language).toBeNull();
  });

  it("lowers ordered and unordered lists, including task checkboxes", () => {
    const blocks = parseMarkdownBlocks("- [x] done\n- [ ] todo\n\n3. third\n4. fourth\n");
    const [unordered, ordered] = blocks;
    if (unordered?.kind !== "list" || ordered?.kind !== "list") throw new Error("expected lists");
    expect(unordered.ordered).toBe(false);
    expect(unordered.items[0]?.checked).toBe(true);
    expect(unordered.items[1]?.checked).toBe(false);
    expect(ordered.ordered).toBe(true);
    expect(ordered.start).toBe(3);
    expect(ordered.items[0]?.checked).toBeNull();
  });

  it("flattens nested list content into child blocks", () => {
    const blocks = parseMarkdownBlocks("- outer\n  - inner\n");
    const [list] = blocks;
    if (list?.kind !== "list") throw new Error("expected a list");
    expect(plain(list.items[0]?.nodes ?? [])).toContain("outer");
    expect(kinds(list.items[0]?.children ?? [])).toEqual(["list"]);
  });

  it("lowers GFM tables into header and row cells", () => {
    const blocks = parseMarkdownBlocks("| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n");
    const [table] = blocks;
    if (table?.kind !== "table") throw new Error("expected a table");
    expect(table.header.map(plain)).toEqual(["a", "b"]);
    expect(table.rows.map((row) => row.map(plain))).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("lowers blockquotes into nested blocks", () => {
    const blocks = parseMarkdownBlocks("> quoted **text**\n");
    const [quote] = blocks;
    if (quote?.kind !== "blockquote") throw new Error("expected a blockquote");
    expect(kinds(quote.blocks)).toEqual(["paragraph"]);
  });

  it("lowers thematic breaks", () => {
    expect(kinds(parseMarkdownBlocks("a\n\n---\n\nb"))).toEqual(["paragraph", "rule", "paragraph"]);
  });

  it("decodes the entities marked escapes so text reads naturally", () => {
    const blocks = parseMarkdownBlocks("a < b && c > d");
    const [paragraph] = blocks;
    if (paragraph?.kind !== "paragraph") throw new Error("expected a paragraph");
    expect(plain(paragraph.nodes)).toBe("a < b && c > d");
  });

  it("merges adjacent runs that share styling", () => {
    const blocks = parseMarkdownBlocks("plain text with no marks at all");
    const [paragraph] = blocks;
    if (paragraph?.kind !== "paragraph") throw new Error("expected a paragraph");
    expect(paragraph.nodes).toHaveLength(1);
  });

  it("renders a half-streamed fence without losing the partial content", () => {
    const blocks = parseMarkdownBlocks("Here you go:\n\n```ts\nconst partial =");
    expect(kinds(blocks)).toEqual(["paragraph", "code"]);
    const code = blocks[1];
    if (code?.kind !== "code") throw new Error("expected a code block");
    expect(code.text).toContain("const partial =");
  });
});
