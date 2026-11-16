import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  // Bundle workspace packages (they ship TypeScript source). npm dependencies stay external:
  // they are CommonJS-heavy and must be listed in this package's dependencies to resolve at runtime.
  noExternal: [/^@uptimewatch\//],
  external: ["drizzle-orm", "ioredis", "pg", "zod"],
});
