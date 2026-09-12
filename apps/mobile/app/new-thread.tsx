// FILE: new-thread.tsx
// Purpose: Project picker sheet for the list's "+" action.
// Layer: Mobile screens
//
// Only reached when there is more than one project; with exactly one the list
// screen dispatches `thread.create` directly rather than asking a question with
// a single answer.

import { router } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { useSynaraStore } from "@/state/synaraStore";
import { Banner } from "@/ui/Banner";
import { Card, CardDivider } from "@/ui/Card";
import { EmptyState } from "@/ui/EmptyState";
import { PressableRow } from "@/ui/PressableRow";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/ThemeProvider";

export default function NewThreadSheet() {
  const theme = useTheme();
  const projects = useSynaraStore((state) => state.shell.projects);
  const threads = useSynaraStore((state) => state.shell.threads);
  const creatingThread = useSynaraStore((state) => state.creatingThread);
  const createThreadError = useSynaraStore((state) => state.createThreadError);
  const createThread = useSynaraStore((state) => state.createThread);
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);

  const pick = useCallback(
    (projectId: string) => {
      if (creatingThread) return;
      setPendingProjectId(projectId);
      void createThread(projectId).then((threadId) => {
        setPendingProjectId(null);
        if (!threadId) return;
        // Replace, so "back" from the thread returns to the list rather than
        // to a sheet whose job is done.
        router.replace({ pathname: "/thread/[id]", params: { id: threadId } });
      });
    },
    [createThread, creatingThread],
  );

  if (projects.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon="folder-open-outline"
          title="No projects"
          message="Add a project in the Synara desktop or web app first."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <Text variant="footnote" color="secondary">
          The new thread inherits the model and runtime mode of the most recent thread in the
          project you choose.
        </Text>
        {createThreadError ? <Banner tone="danger" message={createThreadError} /> : null}
        <Card>
          {projects.map((project, index) => (
            <View key={project.id}>
              {index === 0 ? null : <CardDivider inset={theme.spacing.lg} />}
              <PressableRow
                onPress={() => pick(project.id)}
                disabled={creatingThread}
                accessibilityLabel={`New thread in ${project.title}`}
              >
                <View style={styles.row}>
                  <Text variant="body" numberOfLines={1}>
                    {project.title}
                  </Text>
                  <Text variant="caption" color="tertiary" numberOfLines={1}>
                    {pendingProjectId === project.id
                      ? "Creating…"
                      : `${String(
                          threads.filter((thread) => thread.projectId === project.id).length,
                        )} threads · ${project.workspaceRoot}`}
                  </Text>
                </View>
              </PressableRow>
            </View>
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { gap: 2 },
});
