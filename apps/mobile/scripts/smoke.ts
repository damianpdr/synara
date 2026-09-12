// FILE: smoke.ts
// Purpose: End-to-end proof that the mobile transport speaks the real Synara protocol.
// Layer: Mobile integration script
// Usage:
//   bun apps/mobile/scripts/smoke.ts --base-url http://HOST:3775 --session-token <tok>
//   bun apps/mobile/scripts/smoke.ts --pairing-url 'http://HOST:3775/pair#token=<cred>'
//
// Runs the exact same transport modules the app uses, under bun. It only needs
// global `fetch`, `WebSocket` and `URL`, all of which bun, node >= 22 and
// Hermes (via Expo's polyfills) provide.

import type { ClientOrchestrationCommand, ThreadId } from "@synara/contracts";

import { newId } from "../src/transport/ids";
import { ConnectionManager } from "../src/transport/connectionManager";
import { bootstrapBearer, normalizeBaseUrl, parsePairingUrl } from "../src/transport/synaraAuth";
import type { WebSocketLike } from "../src/transport/rpcSocket";

// Declared rather than pulled from @types/node: adding Node's global types to
// this package would collide with React Native's lib declarations.
declare const process: {
  argv: string[];
  exitCode: number | undefined;
  exit(code?: number): never;
};

const SHELL_WINDOW_MS = 5_000;

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

const log = (message: string) => console.log(`[smoke] ${message}`);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let baseUrl = args["base-url"] ? normalizeBaseUrl(args["base-url"]) : "";
  let sessionToken = args["session-token"] ?? "";

  if (args["pairing-url"]) {
    const parsed = parsePairingUrl(args["pairing-url"]);
    baseUrl = parsed.baseUrl;
    log(`exchanging pairing credential at ${baseUrl} ...`);
    const session = await bootstrapBearer({ baseUrl, credential: parsed.credential });
    sessionToken = session.sessionToken;
    log(`bootstrap ok: role=${session.role} expiresAt=${session.expiresAt}`);
  }

  if (!baseUrl || !sessionToken) {
    console.error(
      "usage: bun apps/mobile/scripts/smoke.ts --base-url <url> --session-token <tok>\n" +
        "   or: bun apps/mobile/scripts/smoke.ts --pairing-url '<url>/pair#token=<cred>'",
    );
    process.exit(2);
  }

  const manager = new ConnectionManager({
    baseUrl,
    sessionToken,
    createWebSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
    log: (message, detail) =>
      log(`transport: ${message}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`),
  });

  const connected = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for connect")), 20_000);
    const unsubscribe = manager.onStateChange((state) => {
      log(
        `state=${state.status}${state.serverInstanceId ? ` instance=${state.serverInstanceId}` : ""}` +
          `${state.lastError ? ` error=${state.lastError}` : ""}`,
      );
      if (state.status === "connected") {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
      if (state.status === "fatal") {
        clearTimeout(timer);
        unsubscribe();
        reject(new Error(`fatal: ${state.lastError ?? "unknown"} (${state.fatalAction ?? "-"})`));
      }
    });
  });

  manager.start();
  await connected;

  const client = manager.getClient();
  if (!client) throw new Error("connected but no client");

  const snapshot = await client.getShellSnapshot();
  log(
    `getShellSnapshot -> sequence=${snapshot.snapshotSequence} projects=${snapshot.projects.length} threads=${snapshot.threads.length}`,
  );
  for (const project of snapshot.projects) {
    log(`  project ${project.id} "${project.title}"`);
  }
  for (const thread of snapshot.threads) {
    log(`  thread  ${thread.id} "${thread.title}"`);
  }

  // --- shell stream -------------------------------------------------------
  // Every Chunk must be Acked or the server's stream fiber blocks forever, so
  // receiving a *second* chunk after the snapshot is the proof that Ack works.
  let shellChunks = 0;
  const shellKinds: string[] = [];
  const shellSubscription = manager.subscribeShell((item) => {
    shellChunks += 1;
    shellKinds.push(item.kind);
    log(
      `shell item #${shellChunks} kind=${item.kind}` +
        (item.kind === "snapshot"
          ? ` sequence=${item.snapshot.snapshotSequence} threads=${item.snapshot.threads.length}`
          : "sequence" in item
            ? ` sequence=${item.sequence}`
            : ""),
    );
  });

  const firstThread = snapshot.threads[0];
  if (firstThread) {
    // A cheap, model-free mutation that is guaranteed to produce shell events
    // while the window is open. Without a working Ack the server would stall
    // after the snapshot chunk and none of these would ever arrive.
    for (let round = 1; round <= 3; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      const command = {
        type: "thread.meta.update",
        commandId: newId("cmd"),
        threadId: firstThread.id,
        title: `${firstThread.title} (smoke ${round})`,
      } as unknown as ClientOrchestrationCommand;
      await client.dispatchCommand(command);
      log(`dispatched thread.meta.update round=${round}`);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, SHELL_WINDOW_MS - 2_700));
  log(
    `shell stream received ${shellChunks} items in ~${SHELL_WINDOW_MS}ms: ${shellKinds.join(", ")}`,
  );
  if (shellChunks < 2) {
    throw new Error(
      "shell stream produced only the snapshot — the Ack handshake is broken (server stalled).",
    );
  }

  // --- thread detail stream ----------------------------------------------
  if (firstThread) {
    let threadItems = 0;
    const threadDone = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 4_000);
      manager.subscribeThread(firstThread.id as ThreadId, (item) => {
        threadItems += 1;
        if (item.kind === "snapshot") {
          log(
            `thread item #${threadItems} kind=snapshot sequence=${item.snapshot.snapshotSequence} ` +
              `messages=${item.snapshot.thread.messages.length} activities=${item.snapshot.thread.activities.length}`,
          );
        } else {
          log(
            `thread item #${threadItems} kind=event type=${item.event.type} sequence=${item.event.sequence}`,
          );
        }
        if (threadItems >= 1) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    await threadDone;
    const detail = await client.getThreadDetailSnapshot(firstThread.id as ThreadId);
    log(
      `getThreadDetailSnapshot -> ${
        detail
          ? `sequence=${detail.snapshotSequence} messages=${detail.thread.messages.length}`
          : "null"
      }`,
    );
  }

  if (firstThread) {
    // Leave the seeded data as we found it.
    await client.dispatchCommand({
      type: "thread.meta.update",
      commandId: newId("cmd"),
      threadId: firstThread.id,
      title: firstThread.title,
    } as unknown as ClientOrchestrationCommand);
    log(`restored thread title to "${firstThread.title}"`);
  }

  shellSubscription.close();
  manager.stop();
  log("closed cleanly. SMOKE PASSED");
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error("[smoke] FAILED:", error);
    process.exit(1);
  },
);
