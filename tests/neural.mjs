import assert from "node:assert/strict";
import { Ecosystem } from "../dist/engine.js";
import { decide, parameterCount } from "../dist/neural.js";
const base = new Ecosystem();
for (const config of [
  { count: 0, depth: 1, width: 6 },
  { count: 1, depth: 1, width: 6 },
  { count: 4, depth: 3, width: 12 },
]) {
  const sim = new Ecosystem(90210, config);
  assert.deepEqual(sim.food, base.food);
  assert.equal(sim.organisms[0].x, base.organisms[0].x);
  const parent = sim.organisms[0];
  sim.mutation = 0;
  const child = sim.create(parent);
  assert.deepEqual(child.brains, parent.brains);
  assert.notEqual(child.brains, parent.brains);
  const start = performance.now();
  for (let i = 0; i < 1800; i++) sim.step(1 / 30);
  assert(
    sim.organisms.length > 0,
    "This seeded smoke scenario must have survivors",
  );
  assert(sim.births > 0, "This seeded smoke scenario must reproduce");
  assert(
    sim.organisms.every(
      (o) =>
        Number.isFinite(o.energy) &&
        Number.isFinite(o.x) &&
        o.control.every(Number.isFinite),
    ),
  );
  console.log({
    config,
    parameters: parameterCount(config),
    population: sim.organisms.length,
    births: sim.births,
    runMs: Math.round(performance.now() - start),
  });
}
const weights = [
  [
    [
      [1, 0, 0, 0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 0, 0, 0],
    ],
  ],
];
assert(decide(weights, [1, 0, 0, 0, 0, 0, 0]).output[0] > 0);
assert(decide(weights, [-1, 0, 0, 0, 0, 0, 0]).output[0] < 0);
const a = new Ecosystem(42, { count: 2, depth: 2, width: 4 }),
  b = new Ecosystem(42, { count: 2, depth: 2, width: 4 });
for (let i = 0; i < 50; i++) {
  a.step(1 / 30);
  b.step(1 / 30);
}
assert.deepEqual(a.organisms, b.organisms);
console.log(
  "Inheritance, input response, finite state, reproducibility, and matching initial conditions passed.",
);
const evolving = new Ecosystem(71, { count: 1, depth: 2, width: 8 });
evolving.mutation = 100;
const p = evolving.organisms[0],
  original = JSON.stringify(p.brains),
  offspring = evolving.create(p);
assert.notDeepEqual(offspring.brains, p.brains);
assert.equal(JSON.stringify(p.brains), original);
assert(offspring.brains.flat(3).every(Number.isFinite));
