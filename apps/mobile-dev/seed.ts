/**
 * Seeds the mobile-dev Synara server with one project + one thread so the
 * mobile client has something to render.
 *
 * Deliberately dependency-free (bun globals only) so this folder needs no
 * package.json and stays out of the workspace graph.
 *
 * Run: bun apps/mobile-dev/seed.ts
 */
const HOST = process.env.BIND_HOST ?? "100.109.152.38";
const PORT = process.env.PORT ?? "3775";
const ORIGIN = `http://${HOST}:${PORT}`;
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? "/Users/damian/workspace/synara";
const SESSION_TOKEN = (await Bun.file("/tmp/synara-mobile-dev/session-token.txt").text()).trim();

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

async function postJson(path: string, body?: unknown) {
  const res = await fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SESSION_TOKEN}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
}

const negotiate = await (
  await fetch(
    `${ORIGIN}/ws/negotiate?x-synara-client-build=seed&x-synara-protocol-epoch=1` +
      `&x-synara-protocol-min-revision=1&x-synara-protocol-max-revision=1`,
  )
).json();
const { token: wsToken } = await postJson("/api/auth/ws-token");

const wsUrl =
  `ws://${HOST}:${PORT}/ws?wsToken=${encodeURIComponent(wsToken)}` +
  `&x-synara-client-build=seed&x-synara-protocol-epoch=1&x-synara-protocol-revision=1` +
  `&x-synara-server-instance=${encodeURIComponent(negotiate.serverInstanceId)}`;

const ws = new WebSocket(wsUrl);
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();
let nextId = 1;

ws.addEventListener("message", (event) => {
  for (const line of String(event.data).split("\n")) {
    if (!line.trim()) continue;
    let frame: any;
    try {
      frame = JSON.parse(line);
    } catch {
      continue;
    }
    // Streaming RPCs need an Ack per Chunk or the server stalls. We only issue
    // unary requests, but handle it so a stray stream can't wedge the socket.
    if (frame._tag === "Chunk") {
      ws.send(JSON.stringify({ _tag: "Ack", requestId: frame.requestId }));
      continue;
    }
    if (frame._tag !== "Exit") continue;
    const entry = pending.get(frame.requestId);
    if (!entry) continue;
    pending.delete(frame.requestId);
    const exit = frame.exit;
    if (exit?._tag === "Success") entry.resolve(exit.value);
    else entry.reject(new Error(`RPC failed: ${JSON.stringify(exit)}`));
  }
});

function rpc(tag: string, payload: unknown): Promise<any> {
  const id = String(nextId++);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(
      JSON.stringify({
        _tag: "Request",
        id,
        tag,
        payload,
        headers: [],
        traceId: uuid().replace(/-/g, ""),
        spanId: uuid().replace(/-/g, "").slice(0, 16),
        sampled: false,
      }),
    );
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`RPC timeout: ${tag}`));
    }, 30_000);
  });
}

const dispatch = (command: unknown) => rpc("orchestration.dispatchCommand", command);

await new Promise<void>((resolve, reject) => {
  ws.addEventListener("open", () => resolve(), { once: true });
  ws.addEventListener("error", (e) => reject(new Error(`ws error: ${e}`)), { once: true });
});
console.log("ws connected");

let snapshot = await rpc("orchestration.getShellSnapshot", {});
console.log(
  `before: projects=${snapshot.projects?.length ?? 0} threads=${snapshot.threads?.length ?? 0}`,
);

// Reuse an existing project for this workspace root so reruns stay idempotent.
let projectId: string | undefined = snapshot.projects?.find(
  (p: any) => p.workspaceRoot === WORKSPACE_ROOT,
)?.id;

if (!projectId) {
  projectId = uuid();
  await dispatch({
    type: "project.create",
    commandId: uuid(),
    projectId,
    title: "Synara (mobile dev)",
    workspaceRoot: WORKSPACE_ROOT,
    createdAt: nowIso(),
  });
  console.log(`created project ${projectId}`);
} else {
  console.log(`reusing project ${projectId}`);
}

const hasThread = snapshot.threads?.some((t: any) => t.projectId === projectId);
if (!hasThread) {
  const threadId = uuid();
  // No thread.turn.start: we deliberately never kick off an agent turn, so this
  // seeds structure without spending model tokens.
  await dispatch({
    type: "thread.create",
    commandId: uuid(),
    threadId,
    projectId,
    title: "Mobile dev smoke thread",
    modelSelection: { provider: "claudeAgent", model: "claude-sonnet-5" },
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: null,
    createdAt: nowIso(),
  });
  console.log(`created thread ${threadId}`);
} else {
  console.log("thread already present");
}

snapshot = await rpc("orchestration.getShellSnapshot", {});
console.log(
  `after: projects=${snapshot.projects?.length ?? 0} threads=${snapshot.threads?.length ?? 0}`,
);
console.log(
  JSON.stringify(
    {
      projects: snapshot.projects?.map((p: any) => ({
        id: p.id,
        title: p.title,
        workspaceRoot: p.workspaceRoot,
      })),
      threads: snapshot.threads?.map((t: any) => ({
        id: t.id,
        projectId: t.projectId,
        title: t.title,
      })),
    },
    null,
    2,
  ),
);
ws.close();
