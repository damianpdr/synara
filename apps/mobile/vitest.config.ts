import { defineConfig } from "vitest/config";

// Only the platform-agnostic modules are unit-tested here: the transport is pure
// logic over `fetch`/`WebSocket`, and `src/features/thread/logic` + the thread
// reducer are pure data transforms with no React Native imports. The default
// node environment is therefore enough. UI is verified on device.
//
// `@/*` mirrors the `paths` mapping in tsconfig.json; Metro and Babel resolve it
// in the app, and this teaches Vite's resolver the same thing for tests.
// `.pathname` rather than `node:url`'s `fileURLToPath`: this package's lib is
// React Native's, so pulling in @types/node here collides with it.
export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
