// FILE: index.tsx
// Purpose: The main screen — every thread, grouped by project, live.
// Layer: Mobile screens
//
// Also the connection gate: with nothing paired it renders the welcome/pairing
// view in place rather than redirecting, so there is no frame where an empty
// thread list flashes before the router catches up.

import { router, Stack } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, SectionList, StyleSheet, View } from "react-native";

import { ConnectView } from "@/features/connections/ConnectView";
import { ConnectionBanner } from "@/features/shell/ConnectionBanner";
import { ThreadRow } from "@/features/shell/ThreadRow";
import { buildThreadSections, type ThreadRow as ThreadRowModel } from "@/features/shell/threadRows";
import { useSynaraStore } from "@/state/synaraStore";
import { Card } from "@/ui/Card";
import { EmptyState } from "@/ui/EmptyState";
import { IconButton } from "@/ui/IconButton";
import { Screen } from "@/ui/Screen";
import { SectionHeader } from "@/ui/SectionHeader";
import { SkeletonThreadList } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/ThemeProvider";

/** Relative timestamps only need to be refreshed about as often as they change. */
const CLOCK_TICK_MS = 30_000;

export default function ThreadsScreen() {
  const theme = useTheme();
  const hydrated = useSynaraStore((state) => state.hydrated);
  const baseUrl = useSynaraStore((state) => state.baseUrl);
  const shell = useSynaraStore((state) => state.shell);
  const connection = useSynaraStore((state) => state.connection);
  const refreshing = useSynaraStore((state) => state.refreshing);
  const creatingThread = useSynaraStore((state) => state.creatingThread);
  const createThreadError = useSynaraStore((state) => state.createThreadError);
  const showArchived = useSynaraStore((state) => state.showArchived);
  const collapsedProjectIds = useSynaraStore((state) => state.collapsedProjectIds);
  const toggleProjectCollapsed = useSynaraStore((state) => state.toggleProjectCollapsed);
  const refreshShell = useSynaraStore((state) => state.refreshShell);
  const reconnectNow = useSynaraStore((state) => state.reconnectNow);
  const createThread = useSynaraStore((state) => state.createThread);

  const [query, setQuery] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const { sections } = useMemo(
    () =>
      buildThreadSections({
        threads: shell.threads,
        projects: shell.projects,
        showArchived,
        query,
        collapsedProjectIds,
        nowMs,
      }),
    [shell.threads, shell.projects, showArchived, query, collapsedProjectIds, nowMs],
  );

  const openThread = useCallback((threadId: string) => {
    router.push({ pathname: "/thread/[id]", params: { id: threadId } });
  }, []);

  const startThread = useCallback(() => {
    const projects = shell.projects;
    if (projects.length === 0) return;
    if (projects.length > 1) {
      router.push("/new-thread");
      return;
    }
    const only = projects[0];
    if (!only) return;
    void createThread(only.id).then((threadId) => {
      if (threadId) router.push({ pathname: "/thread/[id]", params: { id: threadId } });
    });
  }, [createThread, shell.projects]);

  const headerRight = useCallback(
    () => (
      <View style={[styles.headerActions, { gap: theme.spacing.lg }]}>
        <IconButton
          name="settings-outline"
          accessibilityLabel="Settings"
          size={20}
          tone="secondary"
          onPress={() => router.push("/settings")}
        />
        <IconButton
          name="create-outline"
          accessibilityLabel="New thread"
          busy={creatingThread}
          disabled={connection.status !== "connected" || shell.projects.length === 0}
          onPress={startThread}
        />
      </View>
    ),
    [connection.status, creatingThread, shell.projects.length, startThread, theme.spacing.lg],
  );

  // Rebuilding this object on every keystroke makes the native search bar drop
  // focus, so it is memoised on the handler identity alone.
  const searchBarOptions = useMemo(
    () => ({
      placeholder: "Search threads",
      hideWhenScrolling: false,
      onChangeText: (event: { nativeEvent: { text: string } }) => {
        setQuery(event.nativeEvent.text);
      },
      onCancelButtonPress: () => setQuery(""),
    }),
    [],
  );

  if (!hydrated) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: false }} />
        <SkeletonThreadList />
      </Screen>
    );
  }

  if (!baseUrl) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <ConnectView variant="welcome" />
      </>
    );
  }

  const waitingForFirstSnapshot =
    shell.snapshotSequence === 0 && connection.status !== "connected" && sections.length === 0;

  return (
    <Screen>
      {/* `headerShown` is restated here because the gate branches above turn it
          off via setOptions, and that sticks to the route once applied. */}
      <Stack.Screen
        options={{ headerShown: true, headerRight, headerSearchBarOptions: searchBarOptions }}
      />
      <SectionList
        sections={sections}
        keyExtractor={keyExtractor}
        contentInsetAdjustmentBehavior="automatic"
        stickySectionHeadersEnabled={false}
        keyboardDismissMode="on-drag"
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.xxl,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refreshShell()}
            tintColor={theme.colors.textTertiary}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.sm, paddingTop: theme.spacing.sm }}>
            <ConnectionBanner
              connection={connection}
              hasCredentials={baseUrl !== null}
              onRetry={reconnectNow}
              onRepair={() => router.push("/connect")}
            />
            {createThreadError ? (
              <Text variant="footnote" color="danger">
                {createThreadError}
              </Text>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <SectionHeader
            title={section.title}
            count={section.threadCount}
            collapsed={section.collapsed}
            onPress={() => toggleProjectCollapsed(section.id)}
          />
        )}
        renderSectionFooter={({ section }) =>
          section.collapsed || section.threadCount > 0 ? null : (
            <Card>
              <View style={{ padding: theme.spacing.lg }}>
                <Text variant="footnote" color="tertiary">
                  No threads in this project yet.
                </Text>
              </View>
            </Card>
          )
        }
        renderItem={({ item, index, section }) => {
          const isFirst = index === 0;
          const isLast = index === section.data.length - 1;
          return (
            <View
              style={[
                styles.group,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  borderTopWidth: isFirst ? StyleSheet.hairlineWidth : 0,
                  borderBottomWidth: isLast ? StyleSheet.hairlineWidth : 0,
                  borderTopLeftRadius: isFirst ? theme.radii.lg : 0,
                  borderTopRightRadius: isFirst ? theme.radii.lg : 0,
                  borderBottomLeftRadius: isLast ? theme.radii.lg : 0,
                  borderBottomRightRadius: isLast ? theme.radii.lg : 0,
                },
              ]}
            >
              {isFirst ? null : (
                <View
                  style={[
                    styles.seam,
                    { backgroundColor: theme.colors.separator, marginLeft: theme.spacing.xl },
                  ]}
                />
              )}
              <ThreadRow row={item} onPress={openThread} />
            </View>
          );
        }}
        // Only reached when there are no sections at all: with a project
        // present but no threads, the per-section footer says so instead.
        ListEmptyComponent={
          waitingForFirstSnapshot ? (
            <SkeletonThreadList />
          ) : query.trim().length > 0 ? (
            <EmptyState
              icon="search-outline"
              title="No matches"
              message={`Nothing matches “${query.trim()}”.`}
            />
          ) : (
            <EmptyState
              icon="folder-open-outline"
              title="No projects yet"
              message="Add a project in the Synara desktop or web app and it will show up here."
            />
          )
        }
      />
    </Screen>
  );
}

function keyExtractor(row: ThreadRowModel): string {
  return row.id;
}

// Rows inside one project read as a single grouped card: only the first and
// last corners are rounded, and the seams between them are hairlines.
const styles = StyleSheet.create({
  headerActions: { flexDirection: "row", alignItems: "center" },
  group: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  seam: { height: StyleSheet.hairlineWidth },
});
