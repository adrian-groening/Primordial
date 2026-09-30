import { performance } from "node:perf_hooks";
import os from "node:os";
import { PredatorWorld } from "../dist/sim/predator-world.js";

function measure(name, neural, dense = false) {
  const world = new PredatorWorld(90210, neural);
  if (dense) {
    for (let i = 0; i < world.organisms.length; i++) {
      world.organisms[i].x = 300 + (i % 10) * 35;
      world.organisms[i].y = 190 + Math.floor(i / 10) * 35;
    }
  }
  const timings = [];
  const started = performance.now();
  for (let i = 0; i < 300; i++) {
    const before = performance.now();
    world.stepTick();
    timings.push(performance.now() - before);
    if (world.limitDiagnostic) break;
  }
  const elapsedMs = performance.now() - started;
  timings.sort((a, b) => a - b);
  return {
    name, seed: 90210, ticks: world.tick, population: world.organisms.length,
    food: world.food.length, elapsedMs,
    medianTickMs: timings[Math.floor(timings.length / 2)],
    p95TickMs: timings[Math.floor(timings.length * 0.95)],
    ticksPerSecond: world.tick / (elapsedMs / 1000),
    heapUsedBytes: process.memoryUsage().heapUsed,
    energyResidual: world.energyResidual(),
    technicalLimit: world.limitDiagnostic,
  };
}

const report = {
  modelVersion: "predator-v2",
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  cpu: os.cpus()[0]?.model,
  workload: "300 model ticks, 80 prey, 8 predators, 230 starting food items; no browser rendering",
  scenarios: [
    measure("rule-uniform", { count: 0, depth: 1, width: 6 }),
    measure("one-network-uniform", { count: 1, depth: 2, width: 12 }),
    measure("rule-dense", { count: 0, depth: 1, width: 6 }, true),
  ],
};
console.log(JSON.stringify(report, null, 2));
