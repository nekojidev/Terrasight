import { parentPort, workerData } from "node:worker_threads";
import { runScenarios, type EngineInput } from "@terrasight/scenario-engine";

/** Runs the D5 pipeline off the API's event loop (Tech Design §9.1: worker-thread pool). */
const input = workerData as EngineInput;
parentPort!.postMessage(runScenarios(input));
