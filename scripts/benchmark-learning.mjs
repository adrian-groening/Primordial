import { EvolvingWorld } from "../dist/sim/evolving-world.js";
import { worldMetrics } from "./simulation-snapshot.mjs";
import os from "node:os";

const scenarios = [];
for (const seed of [90210, 90211, 90212]) {
  const world = new EvolvingWorld(seed, undefined, 8, { prey: 80, food: 230,
    budgets: { organisms: 10000, food: 100000, carcasses: 20000 } });
  const started = performance.now(); world.stepTick();
  const initial = worldMetrics(world);
  for (let tick = 1; tick < 1800 && !world.limitDiagnostic; tick++) world.stepTick();
  const elapsedMs = performance.now() - started;
  scenarios.push({ seed, elapsedMs, ticksPerSecond: world.tick * 1000 / elapsedMs,
    initial, final: worldMetrics(world), heapUsedBytes: process.memoryUsage().heapUsed });
}
console.log(JSON.stringify({ modelVersion: "predator-v3", node: process.version, cpu: os.cpus()[0]?.model,
  world: { width: 1200, height: 800, prey: 80, predators: 8, food: 230 },
  neural: { count: 1, depth: 2, width: 8 }, parametersPerAnimal: 502,
  note: "Three 60-second ecological runs. Reward and teacher-error changes are diagnostics, not proof of general intelligence or guaranteed survival improvement.", scenarios }, null, 2));
