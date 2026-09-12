// FILE: synaraClient.ts
// Purpose: Typed orchestration wrappers over an open RpcSocket.
// Layer: Mobile transport
// Exports: SynaraClient.
//
// Types come from `@synara/contracts` via `import type` only: the contracts
// package is schema code built on Effect, and the Effect runtime must never
// reach the React Native bundle. Type-only imports are erased by Babel, so
// nothing from `effect` is required at runtime.

import type {
  ClientOrchestrationCommand,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamItem,
  OrchestrationThreadDetailSnapshot,
  OrchestrationThreadStreamItem,
  ThreadId,
} from "@synara/contracts";

import { ORCHESTRATION_METHODS } from "./protocolConstants";
import type { RpcSocket, StreamHandle, StreamHandlers } from "./rpcSocket";

export interface SubscribeThreadInput {
  readonly threadId: ThreadId;
  /**
   * Last sequence the caller already applied. Only meaningful inside the
   * `serverInstanceId` that issued it — see connectionManager, which drops all
   * cursors when the server identity changes.
   */
  readonly afterSequence?: number | undefined;
}

export class SynaraClient {
  constructor(private readonly socket: RpcSocket) {}

  getShellSnapshot(): Promise<OrchestrationShellSnapshot> {
    return this.socket.request<OrchestrationShellSnapshot>(
      ORCHESTRATION_METHODS.getShellSnapshot,
      {},
    );
  }

  getThreadDetailSnapshot(threadId: ThreadId): Promise<OrchestrationThreadDetailSnapshot | null> {
    return this.socket.request<OrchestrationThreadDetailSnapshot | null>(
      ORCHESTRATION_METHODS.getThreadDetailSnapshot,
      { threadId },
    );
  }

  /** The payload IS the bare command object — it is not wrapped. */
  dispatchCommand(command: ClientOrchestrationCommand): Promise<unknown> {
    return this.socket.request(ORCHESTRATION_METHODS.dispatchCommand, command);
  }

  subscribeShell(handlers: StreamHandlers<OrchestrationShellStreamItem>): StreamHandle {
    return this.socket.stream(ORCHESTRATION_METHODS.subscribeShell, {}, handlers);
  }

  subscribeThread(
    input: SubscribeThreadInput,
    handlers: StreamHandlers<OrchestrationThreadStreamItem>,
  ): StreamHandle {
    const payload =
      input.afterSequence === undefined
        ? { threadId: input.threadId }
        : { threadId: input.threadId, afterSequence: input.afterSequence };
    return this.socket.stream(ORCHESTRATION_METHODS.subscribeThread, payload, handlers);
  }

  /**
   * Releases a shell subscription. The server's `unsubscribeShell` handler is
   * `Effect.void` (apps/server/src/wsRpc.ts ~1041): what actually frees the
   * stream lease is interrupting the streaming request, which is what
   * `StreamHandle.close()` sends. The unary call is kept as a courtesy no-op
   * only when the caller has no handle left.
   */
  unsubscribeShell(handle: StreamHandle | null): void {
    handle?.close();
  }

  unsubscribeThread(handle: StreamHandle | null): void {
    handle?.close();
  }
}
