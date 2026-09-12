// FILE: ThreadTimeline.tsx
// Purpose: Virtualized transcript with bottom-pinned auto-scroll.
// Layer: Mobile thread UI
// Exports: ThreadTimeline.
//
// Inverted FlatList: for a chat transcript this is the only layout where
// "pinned to newest" is a *stationary* scroll position (offset 0) rather than a
// moving target chased with scrollToEnd on every streamed delta. Rows are laid
// out bottom-up, so a short thread sits at the bottom of the screen without any
// spacer, and growing the newest row cannot shift the rows above it.
//
// The list is deliberately plain FlatList rather than @legendapp/list: the
// transcript is capped at a few hundred rows by the reducer, and FlatList needs
// no extra dependency to verify under Expo Go.

import { useCallback, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { TimelineRow } from "@/features/thread/logic/timeline";
import { TimelineRowView } from "./TimelineRowView";
import { colors, fontSize, radius, spacing, threadColors } from "./threadTheme";

/** How far from the newest row counts as "the user scrolled up to read". */
const PINNED_THRESHOLD_PX = 80;

export function ThreadTimeline({
  rows,
  emptyLabel,
}: {
  readonly rows: readonly TimelineRow[];
  readonly emptyLabel: string;
}) {
  const listRef = useRef<FlatList<TimelineRow>>(null);
  const [pinned, setPinned] = useState(true);
  const [unseen, setUnseen] = useState(false);
  const lastCountRef = useRef(rows.length);

  // Inverted: index 0 is the newest row, so reverse once per render of a
  // changed list rather than reversing inside the renderer.
  const data = useRef<readonly TimelineRow[]>([]);
  if (data.current.length !== rows.length || data.current[0] !== rows[rows.length - 1]) {
    data.current = rows.toReversed();
  }

  if (rows.length !== lastCountRef.current) {
    // New content while the user is reading history: surface the chip instead
    // of yanking the viewport out from under them.
    if (!pinned && rows.length > lastCountRef.current) setUnseen(true);
    lastCountRef.current = rows.length;
  }

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // In an inverted list, offset 0 *is* the bottom of the transcript.
    const isPinned = event.nativeEvent.contentOffset.y <= PINNED_THRESHOLD_PX;
    setPinned(isPinned);
    if (isPinned) setUnseen(false);
  }, []);

  const jumpToNewest = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setUnseen(false);
    setPinned(true);
  }, []);

  const renderItem = useCallback(
    ({ item }: { readonly item: TimelineRow }) => (
      <View style={styles.rowWrapper}>
        <TimelineRowView row={item} />
      </View>
    ),
    [],
  );

  return (
    <View style={styles.root}>
      <FlatList
        ref={listRef}
        inverted
        data={data.current}
        keyExtractor={(row) => row.key}
        renderItem={renderItem}
        onScroll={onScroll}
        scrollEventThrottle={64}
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        // The full snapshot always arrives up front, so there is nothing to
        // page in; no refresh control is wired and the bounce is inert.
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{emptyLabel}</Text>
          </View>
        }
      />
      {unseen ? (
        <Pressable onPress={jumpToNewest} style={styles.chip} accessibilityRole="button">
          <Ionicons name="arrow-down" size={13} color={colors.background} />
          <Text style={styles.chipLabel}>New</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  // Inverted lists render bottom-up, so the visual gap below a row is its top margin.
  rowWrapper: { marginTop: spacing.md },
  empty: { paddingVertical: spacing.lg, alignItems: "center", transform: [{ scaleY: -1 }] },
  emptyText: { color: colors.muted, fontSize: fontSize.small },
  chip: {
    position: "absolute",
    alignSelf: "center",
    bottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: threadColors.attention,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipLabel: { color: colors.background, fontSize: fontSize.caption, fontWeight: "700" },
});
