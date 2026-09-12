// FILE: ids.ts
// Purpose: Client-generated identifiers for orchestration commands.
// Layer: Mobile transport
// Exports: newId.
//
// Hermes has no `crypto` global and Expo's WinterCG runtime patch does not
// install one (see expo/src/winter/runtime.native.ts), so this must not depend
// on `crypto.randomUUID`. Synara ids are only required to be trimmed non-empty
// strings (packages/contracts/src/baseSchemas.ts `makeEntityId`), not UUIDs, so
// a timestamp + counter + randomness is sufficient and collision-safe enough
// for a single client's command ids.

let counter = 0;

export function newId(prefix: string): string {
  counter = (counter + 1) % 0xffff;
  const time = Date.now().toString(36);
  const seq = counter.toString(36).padStart(3, "0");
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${time}-${seq}-${random}`;
}
