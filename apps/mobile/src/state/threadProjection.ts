// FILE: threadProjection.ts
// Purpose: Fold thread-detail stream items into a minimal message list.
// Layer: Mobile state
// Exports: ThreadProjection, emptyThreadProjection, applyThreadItem.
//
// v1 renders raw message text only. `thread.message-sent` is the single event
// that carries message content (the server projects assistant deltas into it
// and re-emits with `streaming: true` until the segment completes), so folding
// just that event keeps the list live without reimplementing the web app's
// full event projection.

import type { OrchestrationThreadStreamItem } from "@synara/contracts";

export interface ProjectedMessage {
  readonly id: string;
  readonly role: string;
  readonly text: string;
  readonly streaming: boolean;
  readonly createdAt: string;
}

export interface ThreadProjection {
  readonly snapshotSequence: number;
  readonly title: string | null;
  readonly messages: readonly ProjectedMessage[];
  /** Events seen but not projected — surfaced in the UI as a liveness counter. */
  readonly otherEventCount: number;
}

export const emptyThreadProjection: ThreadProjection = {
  snapshotSequence: 0,
  title: null,
  messages: [],
  otherEventCount: 0,
};

export function applyThreadItem(
  projection: ThreadProjection,
  item: OrchestrationThreadStreamItem,
): ThreadProjection {
  if (item.kind === "snapshot") {
    return {
      snapshotSequence: item.snapshot.snapshotSequence,
      title: item.snapshot.thread.title,
      messages: item.snapshot.thread.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        streaming: message.streaming,
        createdAt: message.createdAt,
      })),
      otherEventCount: 0,
    };
  }

  const event = item.event;
  if (event.type !== "thread.message-sent") {
    return { ...projection, otherEventCount: projection.otherEventCount + 1 };
  }

  const next: ProjectedMessage = {
    id: event.payload.messageId,
    role: event.payload.role,
    text: event.payload.text,
    streaming: event.payload.streaming,
    createdAt: event.payload.createdAt,
  };
  const index = projection.messages.findIndex((message) => message.id === next.id);
  const messages =
    index === -1
      ? [...projection.messages, next]
      : projection.messages.map((message, at) => (at === index ? next : message));
  return { ...projection, messages };
}
