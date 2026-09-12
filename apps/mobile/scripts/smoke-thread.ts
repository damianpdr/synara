// FILE: smoke-thread.ts
// Purpose: Protocol proof for the thread screen: subscribe to a thread, optionally
//          start and interrupt a turn, and print every stream item that arrives.
// Layer: Mobile integration script
// Usage:
//   bun apps/mobile/scripts/smoke-thread.ts \
//     --base-url http://100.109.152.38:3775 \
//     --session-token "$(cat /tmp/synara-mobile-dev/session-token.txt)" \
//     [--thread-id <id>] [--dump /tmp/thread-snapshot.json] [--send] [--seconds 60]
//
// Like scripts/smoke.ts it runs the app's own transport modules under bun, so a
// pass here is evidence about the wire protocol, not about the React layer.

import type { ClientOrchestrationCommand, ThreadId } from "@synara/contracts";

import { ConnectionManager } from "../src/transport/connectionManager";
import { newId } from "../src/transport/ids";
import type { WebSocketLike } from "../src/transport/rpcSocket";
import { bootstrapBearer, normalizeBaseUrl, parsePairingUrl } from "../src/transport/synaraAuth";

declare const process: {
  argv: string[];
  exitCode: number | undefined;
  exit(code?: number): never;
};
declare const Bun: { write(path: string, data: string): Promise<number> } | undefined;

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || !token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      index += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

const log = (message: string) => console.log(`[smoke-thread] ${message}`);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let baseUrl = args["base-url"] ? normalizeBaseUrl(args["base-url"]) : "";
  let sessionToken = args["session-token"] ?? "";

  if (args["pairing-url"]) {
    const parsed = parsePairingUrl(args["pairing-url"]);
    baseUrl = parsed.baseUrl;
    const session = await bootstrapBearer({ baseUrl, credential: parsed.credential });
    sessionToken = session.sessionToken;
  }
  if (!baseUrl || !sessionToken) {
    console.error(
      "usage: bun apps/mobile/scripts/smoke-thread.ts --base-url <url> --session-token <tok>",
    );
    process.exit(2);
  }

  const windowSeconds = Number.parseInt(args["seconds"] ?? "60", 10);
  const manager = new ConnectionManager({
    baseUrl,
    sessionToken,
    createWebSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
  });

  const connected = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for connect")), 20_000);
    const unsubscribe = manager.onStateChange((state) => {
      log(`state=${state.status}${state.lastError ? ` error=${state.lastError}` : ""}`);
      if (state.status === "connected") {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
      if (state.status === "fatal") {
        clearTimeout(timer);
        unsubscribe();
        reject(new Error(`fatal: ${state.lastError ?? "unknown"}`));
      }
    });
  });
  manager.start();
  await connected;

  const client = manager.getClient();
  if (!client) throw new Error("connected but no client");

  const shell = await client.getShellSnapshot();
  const threadId = (args["thread-id"] ?? shell.threads[0]?.id ?? "") as ThreadId;
  if (!threadId) throw new Error("no threads on the server");
  const shellThread = shell.threads.find((thread) => thread.id === threadId);
  log(`thread ${threadId} "${shellThread?.title ?? "?"}"`);
  log(
    `modelSelection=${JSON.stringify(shellThread?.modelSelection)} ` +
      `runtimeMode=${shellThread?.runtimeMode} interactionMode=${shellThread?.interactionMode}`,
  );

  let snapshotSeen = false;
  let latestCheckpointTurnCount = 0;
  const subscription = manager.subscribeThread(threadId, (item) => {
    if (item.kind === "snapshot") {
      const thread = item.snapshot.thread;
      log(
        `snapshot sequence=${item.snapshot.snapshotSequence} messages=${thread.messages.length} ` +
          `activities=${thread.activities.length} checkpoints=${thread.checkpoints.length} ` +
          `plans=${thread.proposedPlans.length} ` +
          `pendingInteractions=${thread.pendingInteractions === undefined ? "absent" : thread.pendingInteractions.length} ` +
          `session=${thread.session?.status ?? "null"} latestTurn=${thread.latestTurn?.state ?? "null"}`,
      );
      const kinds = new Map<string, number>();
      for (const activity of thread.activities) {
        kinds.set(activity.kind, (kinds.get(activity.kind) ?? 0) + 1);
      }
      log(
        `activity kinds: ${[...kinds]
          .toSorted((left, right) => right[1] - left[1])
          .map(([kind, count]) => `${kind}×${count}`)
          .join(", ")}`,
      );
      const dumpPath = args["dump"];
      if (dumpPath && !snapshotSeen && typeof Bun !== "undefined") {
        void Bun.write(dumpPath, JSON.stringify(item.snapshot, null, 2));
        log(`wrote snapshot to ${dumpPath}`);
      }
      for (const checkpoint of thread.checkpoints) {
        latestCheckpointTurnCount = Math.max(
          latestCheckpointTurnCount,
          checkpoint.checkpointTurnCount,
        );
      }
      snapshotSeen = true;
      return;
    }
    const event = item.event;
    const detail =
      event.type === "thread.message-sent"
        ? ` role=${event.payload.role} streaming=${event.payload.streaming} chars=${event.payload.text.length}`
        : event.type === "thread.activity-appended"
          ? ` activity=${event.payload.activity.kind} tone=${event.payload.activity.tone} summary=${JSON.stringify(event.payload.activity.summary.slice(0, 90))}`
          : event.type === "thread.session-set"
            ? ` session=${event.payload.session.status} activeTurnId=${event.payload.session.activeTurnId ?? "null"} lastError=${event.payload.session.lastError ?? "null"}`
            : "";
    if (event.type === "thread.turn-diff-completed") {
      latestCheckpointTurnCount = Math.max(
        latestCheckpointTurnCount,
        event.payload.checkpointTurnCount,
      );
    }
    log(`event seq=${event.sequence} type=${event.type}${detail}`);
  });

  if (args["send"] === "true") {
    const command = {
      type: "thread.turn.start",
      commandId: newId("cmd"),
      threadId,
      message: {
        messageId: newId("msg"),
        role: "user",
        text: "Reply with exactly: pong",
        attachments: [],
      },
      runtimeMode: shellThread?.runtimeMode ?? "local",
      interactionMode: shellThread?.interactionMode ?? "ask",
      createdAt: new Date().toISOString(),
    } as unknown as ClientOrchestrationCommand;
    try {
      const result = await client.dispatchCommand(command);
      log(`dispatched thread.turn.start -> ${JSON.stringify(result)}`);
    } catch (error) {
      log(`thread.turn.start REJECTED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, windowSeconds * 1_000));

  // Proves the diff sheet's RPC: the range comes from the newest checkpoint,
  // exactly as latestTurnDiffRange derives it.
  if (latestCheckpointTurnCount > 0) {
    const range = {
      fromTurnCount: Math.max(0, latestCheckpointTurnCount - 1),
      toTurnCount: latestCheckpointTurnCount,
    };
    try {
      const diff = await client.getTurnDiff({ threadId, ...range });
      log(
        `getTurnDiff ${range.fromTurnCount}->${range.toTurnCount} -> ${diff.diff.length} chars, ` +
          `${diff.diff.split("\n").filter((line) => line.startsWith("diff --git")).length} files`,
      );
    } catch (error) {
      log(`getTurnDiff FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    log("getTurnDiff skipped: no checkpoint recorded for this thread");
  }

  if (args["send"] === "true") {
    try {
      const result = await client.dispatchCommand({
        type: "thread.turn.interrupt",
        commandId: newId("cmd"),
        threadId,
        createdAt: new Date().toISOString(),
      } as unknown as ClientOrchestrationCommand);
      log(`dispatched thread.turn.interrupt -> ${JSON.stringify(result)}`);
    } catch (error) {
      log(
        `thread.turn.interrupt REJECTED: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }

  subscription.close();
  manager.stop();
  log("closed cleanly. SMOKE PASSED");
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error("[smoke-thread] FAILED:", error);
    process.exit(1);
  },
);
