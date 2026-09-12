// FILE: [id].tsx
// Purpose: Raw message list for one thread, fed by its detail stream.
// Layer: Mobile screens

import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";

import type { ThreadId } from "@synara/contracts";

import { useSynaraStore } from "@/state/synaraStore";
import { emptyThreadProjection } from "@/state/threadProjection";
import { StatusPill } from "@/ui/StatusPill";
import { colors, spacing } from "@/ui/theme";

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const connection = useSynaraStore((state) => state.connection);
  const watchThread = useSynaraStore((state) => state.watchThread);
  const projection = useSynaraStore((state) => state.threads[id] ?? emptyThreadProjection);

  useEffect(() => {
    // Interrupting on unmount is what frees the server's per-client
    // thread-stream lease (8 per connection).
    if (!id) return;
    return watchThread(id as ThreadId);
  }, [id, watchThread, connection.serverInstanceId]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <StatusPill status={connection.status} />
        <Text style={styles.muted}>
          seq {projection.snapshotSequence} · +{projection.otherEventCount} events
        </Text>
      </View>
      <Text style={styles.title}>{projection.title ?? id}</Text>
      <FlatList
        data={projection.messages}
        keyExtractor={(message) => message.id}
        renderItem={({ item }) => (
          <View style={styles.message}>
            <Text style={styles.role}>
              {item.role}
              {item.streaming ? " · streaming" : ""}
            </Text>
            <Text style={styles.text}>{item.text}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.muted}>No messages in this thread yet.</Text>}
        contentContainerStyle={styles.listContent}
      />
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
  title: { color: colors.text, fontSize: 18, paddingHorizontal: spacing.md },
  listContent: { padding: spacing.md, gap: spacing.sm },
  message: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  role: { color: colors.accent, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" },
  text: { color: colors.text, fontSize: 14 },
  muted: { color: colors.muted, fontSize: 12, paddingHorizontal: spacing.md },
});
