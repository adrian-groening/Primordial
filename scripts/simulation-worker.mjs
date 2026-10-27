import { parentPort, workerData } from "node:worker_threads";
import { EvolvingWorld } from "../dist/sim/evolving-world.js";
import { DEFAULT_NEURAL } from "../dist/sim/evolving-neural.js";
import { TrajectoryRecorder } from "../dist/art/trajectory-recorder.js";
import { exportPathSVG } from "../dist/art/path-art.js";
import { numberInRange } from "../dist/sim/config.js";
import { beginFoodComparison, advanceFoodComparison, foodComparisonResult } from "../dist/sim/decision-lab.js";
import { SimulationStorage, newRunId } from "./simulation-storage.mjs";
import { controlSnapshot, worldMetrics } from "./simulation-snapshot.mjs";

const storage = new SimulationStorage(workerData.dataDirectory);
await storage.init();
let world, runId = newRunId(), paused = false, speed = 1, comparison = null;
let recorder = new TrajectoryRecorder();
let options = { selectedId: null, view: true };
let tps = 0, lastError = null, ioError = null, checkpointAt = Date.now();
const defaults = { width: 1200, height: 800, prey: 80, food: 230,
  budgets: { organisms: 10000, food: 100000, carcasses: 20000 } };
function fresh(config = {}) {
  const { seed = 90210, neural = DEFAULT_NEURAL, predators = 8, renewal = 60, mutation = 12, ...settings } = config;
  const next = new EvolvingWorld(seed, neural, predators, { ...defaults, ...settings });
  next.renewal = renewal; next.mutation = mutation;
  return next;
}
function restore(envelope) {
  if (envelope?.format !== "primordial-local-v1") throw new RangeError("Unsupported local checkpoint");
  const next = EvolvingWorld.restore(envelope.state);
  next.limitDiagnostic = envelope.limitDiagnostic ?? null;
  next.limitReached = !!next.limitDiagnostic;
  const nextSpeed = envelope.speed === "max" ? "max" : numberInRange(envelope.speed, "speed", 0.1, 100);
  const nextRecorder = envelope.art ? TrajectoryRecorder.restore(envelope.art) : new TrajectoryRecorder();
  if (!envelope.art) nextRecorder.reset(next);
  world = next; runId = envelope.runId; speed = nextSpeed; paused = true;
  recorder = nextRecorder;
  comparison = null; lastError = null; options.selectedId = null;
}
try { restore(await storage.read()); }
catch (error) {
  if (error.code !== "ENOENT") ioError = `Could not restore latest checkpoint: ${error.message}`;
  world = fresh();
}
function envelope() {
  return { format: "primordial-local-v1", savedAt: new Date().toISOString(), runId,
    speed, limitDiagnostic: world.limitDiagnostic, state: world.exportState(), art: recorder.exportState() };
}
function snapshot() {
  const decision = comparison && {
    proposed: comparison.proposed, original: comparison.original, start: comparison.start,
    ticks: comparison.ticks, horizon: comparison.horizon, done: comparison.done,
    censored: comparison.censored, result: foodComparisonResult(comparison),
  };
  return controlSnapshot(world, { paused, speed, ticksPerSecond: tps,
    actualSpeed: tps / 30, runId, error: lastError, storageError: ioError, comparison: decision }, options);
}
let stopped = false, due = performance.now(), measuredAt = due, measuredTicks = 0;
function pump() {
  if (stopped) return;
  const started = performance.now();
  try {
    if (comparison && !comparison.done) {
      do { advanceFoodComparison(comparison, 1); }
      while (!comparison.done && performance.now() - started < 15);
    } else if (!paused) {
      if (speed !== "max") due = Math.max(due, started - 1000);
      while ((speed === "max" || performance.now() >= due) && performance.now() - started < 15) {
        if (!world.stepTick()) { paused = true; break; }
        recorder.capture(world);
        measuredTicks++;
        if (speed !== "max") due += 1000 / (30 * speed);
      }
    }
  } catch (error) { paused = true; lastError = error.message; }
  const now = performance.now();
  if (now - measuredAt >= 500) {
    tps = measuredTicks * 1000 / (now - measuredAt);
    measuredTicks = 0; measuredAt = now;
  }
  const delay = comparison && !comparison.done || !paused && speed === "max"
    ? 1 : paused ? 25 : Math.min(25, Math.max(1, due - now));
  setTimeout(pump, delay);
}
let commandQueue = Promise.resolve();
parentPort.on("message", (message) => {
  commandQueue = commandQueue.then(async () => {
    let result = null;
    try {
      const { action, payload = {} } = message;
      if (action === "snapshot") {
        options = { ...options, ...payload };
      } else if (action === "playback") {
        if (payload.speed !== undefined) speed = payload.speed === "max" ? "max" : numberInRange(payload.speed, "speed", 0.1, 100);
        if (payload.paused !== undefined) {
          if (typeof payload.paused !== "boolean") throw new TypeError("paused must be boolean");
          if (!payload.paused && world.limitDiagnostic) throw new Error("Raise the hit budget before resuming");
          paused = payload.paused;
        }
        comparison = null; due = performance.now();
      } else if (action === "settings") {
        const wasLimited = !!world.limitDiagnostic;
        result = world.applyLiveSettings(payload);
        comparison = null;
        if (wasLimited && !world.limitDiagnostic) { paused = false; due = performance.now(); }
      } else if (action === "restart") {
        const next = fresh({ width: world.width, height: world.height, boundary: world.boundary,
          fovDegrees: world.fovDegrees, prey: world.initialPrey, food: world.initialFood,
          predators: world.initialPredators, budgets: world.budgets, neural: world.neural,
          renewal: world.renewal, mutation: world.mutation, intelligence: world.intelligence, ...payload });
        world = next; runId = newRunId(); comparison = null; options.selectedId = null;
        recorder.reset(world);
        lastError = null; paused = false; due = performance.now();
      } else if (action === "schedule") {
        result = world.schedule({ ...payload, tick: payload.tick ?? world.tick + 1 });
        comparison = null;
        if (payload.type === "impact") paused = false;
      } else if (action === "raiseBudget") {
        world.raiseBudget(payload.store, payload.value); paused = false; due = performance.now();
      } else if (action === "inspect") {
        const candidates = world.organisms.filter((o) => !payload.role || o.role === payload.role);
        const index = candidates.findIndex((o) => o.id === payload.previousId);
        options.selectedId = candidates[(index + 1) % candidates.length]?.id ?? null;
      } else if (action === "compare") {
        if (world.limitDiagnostic) throw new Error("Raise the hit budget before comparing");
        comparison = beginFoodComparison(world); paused = true;
      } else if (action === "applyComparison") {
        if (!comparison?.done || comparison.censored) throw new Error("No completed comparison to apply");
        result = world.schedule({ type: "renewal", value: comparison.proposed, tick: world.tick + 1 });
        comparison = null; paused = false; due = performance.now();
      } else if (action === "discardComparison") {
        comparison = null; paused = false; due = performance.now();
      } else if (action === "checkpoint") {
        result = await storage.checkpoint(envelope(), true); ioError = null;
      } else if (action === "checkpoints") {
        result = await storage.list();
      } else if (action === "artSnapshot") {
        result = recorder.snapshot(runId, Number(payload.since) || 0, payload.streamId);
      } else if (action === "artExport") {
        result = { svg: exportPathSVG(recorder.snapshot(runId), payload.theme ?? "aurora"), tick: world.tick };
      } else if (action === "restore") {
        restore(await storage.read(payload.name)); due = performance.now();
      } else if (action === "shutdown") {
        paused = true; stopped = true;
        result = await storage.checkpoint(envelope());
      } else throw new RangeError("Unknown simulation action");
      parentPort.postMessage({ id: message.id, result, snapshot: snapshot() });
    } catch (error) {
      parentPort.postMessage({ id: message.id, error: error.message });
    }
  }).catch((error) => { paused = true; lastError = error.message; });
});
let persisting = false;
let lastRecorded = null;
let diskArtSequence = 0, diskArtStream = null;
const telemetry = setInterval(async () => {
  if (persisting || stopped) return;
  persisting = true;
  try {
    const key = `${runId}:${world.tick}:${world.organisms.length}:${world.food.length}:${world.births}:${paused}`;
    if (key !== lastRecorded) {
      await storage.record(runId, { recordedAt: new Date().toISOString(), ...worldMetrics(world), ticksPerSecond: tps, paused });
      lastRecorded = key;
    }
    const paths = recorder.snapshot(runId, diskArtSequence, diskArtStream);
    if (paths.segments.length) {
      await storage.recordPaths(runId, paths);
      diskArtSequence = paths.sequence; diskArtStream = paths.streamId;
    }
    if (!stopped && Date.now() - checkpointAt >= 60000) {
      await storage.checkpoint(envelope()); checkpointAt = Date.now();
    }
    ioError = null;
  } catch (error) { ioError = error.message; }
  finally { persisting = false; }
}, 1000);
telemetry.unref();
parentPort.postMessage({ ready: true });
pump();
