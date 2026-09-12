// FILE: threads.tsx
// Purpose: Live projects -> threads list fed by the shell stream.
// Layer: Mobile screens

import { Link, router } from "expo-router";
import { useMemo } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";

import { useSynaraStore } from "@/state/synaraStore";
import { StatusPill } from "@/ui/StatusPill";
import { colors, spacing } from "@/ui/theme";

export default function ThreadsScreen() {
  const shell = useSynaraStore((state) => state.shell);
  const connection = useSynaraStore((state) => state.connection);

  const sections = useMemo(
    () =>
      shell.projects.map((project) => ({
        title: project.title,
        data: shell.threads.filter((thread) => thread.projectId === project.id),
      })),
    [shell.projects, shell.threads],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <StatusPill status={connection.status} />
        <Text style={styles.muted}>seq {shell.snapshotSequence}</Text>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(thread) => thread.id}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <Link href={{ pathname: "/thread/[id]", params: { id: item.id } }} asChild>
            <Pressable style={styles.row}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.muted}>
                {item.latestTurn?.state ?? "idle"} · {item.updatedAt}
              </Text>
            </Pressable>
          </Link>
        )}
        ListEmptyComponent={
          <Text style={styles.muted}>
            {connection.status === "connected" ? "No threads yet." : "Waiting for the server..."}
          </Text>
        }
        contentContainerStyle={styles.listContent}
      />
      <Pressable style={styles.secondary} onPress={() => router.push("/")}>
        <Text style={styles.muted}>Connection settings</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.md,
  },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.xs },
  sectionHeader: {
    color: colors.accent,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  rowTitle: { color: colors.text, fontSize: 15 },
  muted: { color: colors.muted, fontSize: 12 },
  secondary: { padding: spacing.md, alignItems: "center" },
});
