// FILE: Markdown.tsx
// Purpose: Render the markdown block model with React Native primitives.
// Layer: Mobile thread UI
// Exports: Markdown, CodeBlock.
//
// Pairs with src/features/thread/logic/markdown.ts, which owns all parsing. This
// file only maps blocks to views, so the tricky part (GFM lexing) stays unit
// tested without a React Native environment.
//
// oxlint-disable react/no-array-index-key -- every list in this file is
// positional: markdown blocks, inline runs and table cells have no identity
// beyond their position, and the whole list is rebuilt whenever the source
// string changes. Nothing is ever inserted, removed or reordered in place, so
// the index IS the stable key; a synthesized content key would only make
// reconciliation churn on every streamed delta.

import { memo, useMemo, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import {
  parseMarkdownBlocks,
  type InlineNode,
  type MarkdownBlock,
} from "@/features/thread/logic/markdown";
import {
  fontSize,
  MONO_FONT,
  radius,
  spacing,
  useThreadTokens,
  type ThreadTokens,
} from "./threadTheme";

function openLink(href: string): void {
  // `canOpenURL` needs LSApplicationQueriesSchemes for custom schemes, which
  // Expo Go does not carry, so just attempt the open and swallow the rejection.
  void Linking.openURL(href).catch(() => undefined);
}

function InlineRun({
  nodes,
  style,
}: {
  readonly nodes: readonly InlineNode[];
  readonly style?: StyleProp<TextStyle>;
}) {
  const t = useThreadTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  return (
    <Text style={style}>
      {nodes.map((node, index) => {
        const nodeStyle: StyleProp<TextStyle> = [
          node.bold ? styles.bold : null,
          node.italic ? styles.italic : null,
          node.strikethrough ? styles.strikethrough : null,
          node.code ? styles.inlineCode : null,
          node.href !== null ? styles.link : null,
        ];
        const href = node.href;
        return (
          <Text
            // Inline runs have no stable identity of their own; the index is the
            // identity, and the list is fully rebuilt whenever the text changes.
            key={index}
            style={nodeStyle}
            {...(href === null
              ? {}
              : { onPress: () => openLink(href), suppressHighlighting: true })}
          >
            {node.text}
          </Text>
        );
      })}
    </Text>
  );
}

export function CodeBlock({
  text,
  language,
}: {
  readonly text: string;
  readonly language: string | null;
}) {
  const t = useThreadTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void Clipboard.setStringAsync(text);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_500);
  };
  return (
    <View style={styles.codeBlock}>
      <View style={styles.codeHeader}>
        <Text style={styles.codeLanguage}>{language ?? "code"}</Text>
        <Pressable
          onPress={copy}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Copy code"
        >
          <Ionicons
            name={copied ? "checkmark" : "copy-outline"}
            size={14}
            color={copied ? t.threadColors.attention : t.colors.muted}
          />
        </Pressable>
      </View>
      {/* Code must never reflow: a horizontal scroller keeps indentation and
          long lines readable instead of wrapping them into soup. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.codeScroll}
      >
        <Text style={styles.codeText} selectable>
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

function TableBlockView({
  header,
  rows,
}: {
  readonly header: readonly (readonly InlineNode[])[];
  readonly rows: readonly (readonly (readonly InlineNode[])[])[];
}) {
  const t = useThreadTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  // Tables can be arbitrarily wide; a horizontal scroller beats squeezing every
  // column into a phone width. Fixed-width cells keep the columns aligned
  // without a two-pass measure.
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeaderRow]}>
          {header.map((cell, index) => (
            <View key={index} style={styles.tableCell}>
              <InlineRun nodes={cell} style={styles.tableHeaderText} />
            </View>
          ))}
        </View>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.tableRow}>
            {row.map((cell, cellIndex) => (
              <View key={cellIndex} style={styles.tableCell}>
                <InlineRun nodes={cell} style={styles.tableText} />
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Blocks({
  blocks,
  depth,
}: {
  readonly blocks: readonly MarkdownBlock[];
  readonly depth: number;
}) {
  const t = useThreadTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading":
            return (
              <InlineRun
                key={index}
                nodes={block.nodes}
                style={[styles.heading, styles[HEADING_STYLE_KEY[block.level]]]}
              />
            );
          case "paragraph":
            return <InlineRun key={index} nodes={block.nodes} style={styles.paragraph} />;
          case "code":
            return <CodeBlock key={index} text={block.text} language={block.language} />;
          case "rule":
            return <View key={index} style={styles.rule} />;
          case "blockquote":
            return (
              <View key={index} style={styles.blockquote}>
                <Blocks blocks={block.blocks} depth={depth + 1} />
              </View>
            );
          case "table":
            return <TableBlockView key={index} header={block.header} rows={block.rows} />;
          case "list":
            return (
              <View key={index} style={styles.list}>
                {block.items.map((item, itemIndex) => (
                  <View key={itemIndex} style={styles.listItem}>
                    <Text style={styles.listMarker}>
                      {item.checked !== null
                        ? item.checked
                          ? "☑"
                          : "☐"
                        : block.ordered
                          ? `${block.start + itemIndex}.`
                          : "•"}
                    </Text>
                    <View style={styles.listBody}>
                      <InlineRun nodes={item.nodes} style={styles.paragraph} />
                      {item.children.length > 0 ? (
                        <Blocks blocks={item.children} depth={depth + 1} />
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            );
        }
      })}
    </>
  );
}

/**
 * Renders GFM markdown. Memoized on the source string: streamed assistant text
 * re-renders on every delta, and re-lexing an unchanged message is pure waste.
 */
export const Markdown = memo(function Markdown({ text }: { readonly text: string }) {
  const t = useThreadTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  const blocks = useMemo(() => parseMarkdownBlocks(text), [text]);
  if (blocks.length === 0) return null;
  return (
    <View style={styles.root}>
      <Blocks blocks={blocks} depth={0} />
    </View>
  );
});

function makeStyles(t: ThreadTokens) {
  return StyleSheet.create({
    root: { gap: spacing.sm },
    paragraph: { color: t.colors.text, fontSize: fontSize.body, lineHeight: 22 },
    heading: { color: t.colors.text, fontWeight: "700", marginTop: spacing.xs },
    heading1: { fontSize: fontSize.heading },
    heading2: { fontSize: fontSize.title },
    heading3: { fontSize: fontSize.body + 1 },
    heading4: { fontSize: fontSize.body },
    heading5: { fontSize: fontSize.small },
    heading6: { fontSize: fontSize.small, color: t.colors.muted },
    bold: { fontWeight: "700" },
    italic: { fontStyle: "italic" },
    strikethrough: { textDecorationLine: "line-through", color: t.colors.muted },
    link: { color: t.threadColors.link, textDecorationLine: "underline" },
    inlineCode: {
      fontFamily: MONO_FONT,
      fontSize: fontSize.small,
      color: t.threadColors.attention,
      backgroundColor: t.threadColors.codeBackground,
    },
    codeBlock: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
      borderRadius: radius.md,
      backgroundColor: t.threadColors.codeBackground,
      overflow: "hidden",
    },
    codeHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.colors.border,
    },
    codeLanguage: {
      color: t.colors.muted,
      fontSize: fontSize.micro,
      letterSpacing: 1,
      textTransform: "uppercase",
    },
    codeScroll: { padding: spacing.sm },
    codeText: {
      fontFamily: MONO_FONT,
      fontSize: fontSize.small,
      color: t.colors.text,
      lineHeight: 19,
    },
    rule: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.colors.border,
      marginVertical: spacing.xs,
    },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: t.colors.border,
      paddingLeft: spacing.sm,
      gap: spacing.sm,
    },
    list: { gap: spacing.xs },
    listItem: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
    listMarker: { color: t.colors.muted, fontSize: fontSize.body, lineHeight: 22, minWidth: 18 },
    listBody: { flex: 1, gap: spacing.xs },
    tableScroll: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
      borderRadius: radius.sm,
    },
    table: { minWidth: "100%" },
    tableRow: { flexDirection: "row" },
    tableHeaderRow: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.colors.border,
    },
    tableCell: {
      width: 132,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: t.colors.border,
    },
    tableHeaderText: { color: t.colors.text, fontSize: fontSize.small, fontWeight: "700" },
    tableText: { color: t.colors.text, fontSize: fontSize.small },
  });
}

/** Per-level heading size, resolved through the style sheet so it follows the theme. */
const HEADING_STYLE_KEY = {
  1: "heading1",
  2: "heading2",
  3: "heading3",
  4: "heading4",
  5: "heading5",
  6: "heading6",
} as const;
