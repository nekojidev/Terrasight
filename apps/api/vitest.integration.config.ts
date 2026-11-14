import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// Testcontainers suites kept in the hackathon (Tech Design §1.1): partial unique indexes,
// the analysis pipeline and the commit / Undo race.
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ["test/**/*.int.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
