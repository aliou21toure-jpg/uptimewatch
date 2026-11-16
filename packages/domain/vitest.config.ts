import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    // Integration tests share one database; run files sequentially for deterministic cleanup.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
