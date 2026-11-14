import { defineConfig } from "cypress";

/** P0 path end to end (S-09.04): against the local stack or the public host (CYPRESS_BASE_URL). */
export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL ?? "http://localhost:3000",
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: false,
    defaultCommandTimeout: 15_000,
    viewportWidth: 1440,
    viewportHeight: 1000,
    video: false,
    screenshotOnRunFailure: true,
  },
});
