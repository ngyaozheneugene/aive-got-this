import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// One config, three suites. CI splits them by --dir so the G suite can run on
// every commit without calling the LLM gateway.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@evals": fileURLToPath(new URL("./evals", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    passWithNoTests: true,
  },
});
