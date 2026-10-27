import { parentPort, workerData } from "node:worker_threads";
import { EvolvingWorld } from "../dist/sim/evolving-world.js";
import { TrajectoryRecorder } from "../dist/art/trajectory-recorder.js";
import { exportPathSVG } from "../dist/art/path-art.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SimulationStorage, newRunId } from "./simulation-storage.mjs";
import { worldMetrics } from "./simulation-snapshot.mjs";

const { config, ticks, outputDirectory } = workerData;
const { seed, neural, predators, renewal = 60, mutation = 12, ...options } = config;
const storage = new SimulationStorage(outputDirectory);
await storage.init();
const runId = newRunId(), started = performance.now();
const world = new EvolvingWorld(seed, neural, predators, options);
const recorder = new TrajectoryRecorder(); recorder.reset(world);
let artSequence = 0, artStream = null;
world.renewal = renewal; world.mutation = mutation;
await storage.record(runId, worldMetrics(world));
while (world.tick < ticks && !world.limitDiagnostic) {
  world.stepTick();
  recorder.capture(world);
  if (world.tick % 300 === 0 && !world.limitDiagnostic) {
    await storage.record(runId, worldMetrics(world));
    const art = recorder.snapshot(runId, artSequence, artStream);
    await storage.recordPaths(runId, art); artSequence = art.sequence; artStream = art.streamId;
    parentPort.postMessage({ progress: true, tick: world.tick, seed });
  }
}
const elapsedMs = performance.now() - started;
const result = { runId, seed, requestedTicks: ticks, ...worldMetrics(world), elapsedMs,
  ticksPerSecond: world.tick * 1000 / elapsedMs, heapUsedBytes: process.memoryUsage().heapUsed };
await storage.record(runId, result);
await storage.recordPaths(runId, recorder.snapshot(runId, artSequence, artStream));
await writeFile(join(outputDirectory, "motion-art.svg"), exportPathSVG(recorder.snapshot(runId)));
const checkpoint = await storage.checkpoint({ format: "primordial-local-v1", runId, speed: "max",
  savedAt: new Date().toISOString(), limitDiagnostic: world.limitDiagnostic, state: world.exportState(), art: recorder.exportState() }, true);
parentPort.postMessage({ complete: true, result: { ...result, checkpoint: checkpoint.name } });
