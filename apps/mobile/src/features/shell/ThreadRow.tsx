// FILE: ThreadRow.tsx
// Purpose: One thread in the list — status, title, branch, last activity.
// Layer: Mobile shell feature
// Exports: ThreadRow, THREAD_ROW_HEIGHT.

import { memo } from "react";
import { StyleSheet, View } from "react-native";

import type { ThreadRow as ThreadRowModel } from "@/features/shell/threadRows";
import { threadStatusLabel } from "@/features/shell/threadStatus";
import { Chip, Dot } from "@/ui/Pill";
import { PressableRow } from "@/ui/PressableRow";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/ThemeProvider";

/** Two-line worst case; only used as a `getItemLayout` hint, not a hard size. */
export const THREAD_ROW_HEIGHT = 62;

export interface ThreadRowProps {
  readonly row: ThreadRowModel;
  readonly onPress: (threadId: string) => void;
}

function ThreadRowImpl({ row, onPress }: ThreadRowProps) {
  const theme = useTheme();
  const tone = theme.colors.status[row.status];
  const showSubtitle = row.status !== "idle" || row.branch !== null;

  return (
    <PressableRow
      // No disclosure chevron: a long list of them is visual noise, and the
      // whole row is obviously tappable.
      chevron={false}
      accessibilityLabel={`${row.title}, ${threadStatusLabel(row.status)}, ${row.relativeTime}`}
      onPress={() => onPress(row.id)}
      style={styles.row}
    >
      <View style={[styles.layout, { gap: theme.spacing.md }]}>
        <View style={styles.dotColumn}>
          <Dot color={tone.dot} size={row.needsAttention ? 9 : 7} />
        </View>
        <View style={styles.main}>
          <Text variant="body" weight="500" numberOfLines={1}>
            {row.title}
          </Text>
          {showSubtitle ? (
            <View style={[styles.subtitle, { gap: theme.spacing.sm, marginTop: 3 }]}>
              {row.status === "idle" ? null : (
                <Text variant="footnote" weight="600" style={{ color: tone.fg }}>
                  {threadStatusLabel(row.status)}
                </Text>
              )}
              {row.branch === null ? null : <Chip label={row.branch} icon="⎇" />}
            </View>
          ) : null}
        </View>
        <Text variant="footnote" color="tertiary">
          {row.relativeTime}
        </Text>
      </View>
    </PressableRow>
  );
}

/**
 * Memoised on the row model, which `buildThreadSections` rebuilds only when the
 * shell projection changes — so a live event for one thread does not re-render
 * the whole list.
 */
export const ThreadRow = memo(ThreadRowImpl);

const styles = StyleSheet.create({
  row: { paddingVertical: 11 },
  layout: { flexDirection: "row", alignItems: "center" },
  dotColumn: { width: 9, alignItems: "center" },
  main: { flex: 1 },
  subtitle: { flexDirection: "row", alignItems: "center" },
});
