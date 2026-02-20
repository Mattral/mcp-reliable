import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Point workspace package names at their TS source rather than dist/,
    // so `vitest` never requires a prior `npm run build`. The `build`
    // script (tsc -b, producing dist/) is still what the CLI/server run
    // against at runtime and what CI type-checks — see docs/testing.md.
    alias: {
      "@mcp-reliable/core": path.resolve(root, "packages/core/src/index.ts"),
      "@mcp-reliable/storage": path.resolve(root, "packages/storage/src/index.ts"),
      "@mcp-reliable/collector": path.resolve(root, "packages/collector/src/index.ts")
    }
  },
  test: {
    environment: "node",
    include: ["packages/*/test/**/*.test.ts", "examples/*/test/**/*.test.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.d.ts", "**/dist/**"]
    }
  }
});
