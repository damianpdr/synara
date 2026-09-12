import { defineConfig } from "vitest/config";

// Only the platform-agnostic transport modules are unit-tested here: they are
// pure logic over `fetch`/`WebSocket` and need no React Native runtime, so the
// default node environment is enough. UI is verified on device.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
