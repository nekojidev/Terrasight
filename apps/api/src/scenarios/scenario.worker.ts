import { parentPort } from "node:worker_threads";
import { runScenarios, type EngineInput } from "@terrasight/scenario-engine";

/**
 * Runs the D5 pipeline off the API's event loop (Tech Design §9.1: worker-thread pool). The worker is reused:
 * each message is one job, answered with `{ ok, result | error }`.
 */
parentPort!.on("message", (input: EngineInput) => {
  try {
    parentPort!.postMessage({ ok: true, result: runScenarios(input) });
  } catch (e) {
    parentPort!.postMessage({ ok: false, error: (e as Error).message });
  }
});
