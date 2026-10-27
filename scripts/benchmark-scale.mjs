import os from "node:os";
import { PredatorWorld } from "../dist/sim/predator-world.js";

function measure(prey, ticks) {
  const predators = Math.round(prey / 20), side = Math.ceil(Math.sqrt(prey / 2000) * 12000);
  const before = performance.now();
  const world = new PredatorWorld(90210, { count: 1, depth: 1, width: 6 }, predators, {
    width: side, height: side, prey, food: Math.min(100000, prey * 6),
    budgets: { organisms: 100000, food: 100000, carcasses: 100000 },
  });
  const initializationMs = performance.now() - before;
  const started = performance.now(), timings = [];
  for (let i = 0; i < ticks; i++) {
    const tickStarted = performance.now();
    world.stepTick(); timings.push(performance.now() - tickStarted);
    if (world.limitDiagnostic) break;
  }
  const elapsedMs = performance.now() - started;
  timings.sort((a, b) => a - b);
  return { initialPopulation: prey + predators, initialFood: prey * 6, ticks: world.tick,
    initializationMs, elapsedMs, ticksPerSecond: world.tick * 1000 / elapsedMs,
    medianTickMs: timings[Math.floor(timings.length / 2)], p95TickMs: timings[Math.floor(timings.length * 0.95)],
    heapUsedBytes: process.memoryUsage().heapUsed, energyResidual: world.energyResidual(),
    technicalLimit: world.limitDiagnostic };
}
console.log(JSON.stringify({ node: process.version, cpu: os.cpus()[0]?.model,
  platform: process.platform, arch: process.arch, neural: { count: 1, depth: 1, width: 6 },
  note: "Short headless CPU throughput measurement. Not a long-run stability or browser FPS guarantee.",
  scenarios: [measure(80, 300), measure(2000, 120), measure(10000, 60)],
}, null, 2));
