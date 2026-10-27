import test from "node:test";
import assert from "node:assert/strict";
import { PredatorWorld } from "../dist/sim/predator-world.js";
import { bodyRadius, hasBodySpace } from "../dist/sim/body-space.js";

test("expanding the live world adds space without moving or resetting its inhabitants", () => {
  const world = new PredatorWorld(19, { count: 1, depth: 1, width: 6 }, 2,
    { prey: 3, food: 4, height: 800 });
  for (let i = 0; i < 30; i++) world.stepTick();
  const before = world.exportState();
  world.applyLiveSettings({ width: 1200, height: 2000, fovDegrees: 120 });
  assert.equal(world.tick, before.tick);
  assert.equal(world.time, before.time);
  assert.equal(world.width, 1200);
  assert.equal(world.height, 2000);
  assert.equal(world.fovDegrees, 120);
  assert.deepEqual(world.organisms, before.organisms);
  assert.deepEqual(world.food, before.food);
  assert.deepEqual(world.history, before.history);
  assert.equal(world.seed, before.seed);
  assert(Math.abs(world.energyResidual()) < 1e-8);
  world.stepTick();
  assert.equal(world.tick, before.tick + 1);
});

test("shrinking relocates occupants safely and failed edits leave state untouched", () => {
  const world = new PredatorWorld(19, undefined, 0, { prey: 2, food: 0 });
  world.organisms[0].x = 500; world.organisms[0].y = 1500;
  world.organisms[1].x = 500; world.organisms[1].y = 1700;
  world.applyLiveSettings({ height: 400, boundary: "periodic" });
  for (const organism of world.organisms) {
    assert(organism.x >= 0 && organism.x < world.width);
    assert(organism.y >= 0 && organism.y < world.height);
    assert(hasBodySpace(organism, bodyRadius(organism), world.organisms, world.obstacles,
      world.width, world.height, true, organism.id));
  }
  const before = world.stateKey();
  assert.throws(() => world.applyLiveSettings({ height: 249 }), /height/);
  assert.throws(() => world.applyLiveSettings({ budgets: { organisms: 1 } }), /budgets/);
  assert.equal(world.stateKey(), before);
});

test("live count changes record external additions and removals without resetting time", () => {
  const world = new PredatorWorld(21, undefined, 1, { prey: 2, food: 2 });
  for (let i = 0; i < 15; i++) world.stepTick();
  const tick = world.tick;
  const oldestPrey = world.organisms.find((o) => o.role === "prey").id;
  world.applyLiveSettings({ prey: 3, predators: 2, food: 4 });
  assert.equal(world.organisms.filter((o) => o.role === "prey").length, 3);
  assert.equal(world.organisms.filter((o) => o.role === "predator").length, 2);
  assert.equal(world.food.length, 4);
  assert(Math.abs(world.energyResidual()) < 1e-8);
  world.applyLiveSettings({ prey: 1, predators: 0, food: 1 });
  assert.equal(world.tick, tick);
  assert.deepEqual(world.organisms.map((o) => o.id), [oldestPrey]);
  assert.equal(world.food.length, 1);
  assert(world.ledger.output > 0);
  assert(Math.abs(world.energyResidual()) < 1e-8);
  assert.equal(PredatorWorld.restore(world.exportState()).stateKey(), world.stateKey());
});

test("live neural changes preserve shared weights and archive earlier architectures", () => {
  const world = new PredatorWorld(22, { count: 1, depth: 1, width: 6 }, 0,
    { prey: 1, food: 0 });
  const organism = world.organisms[0];
  const original = structuredClone(organism.brains);
  const id = organism.id;
  world.applyLiveSettings({ neural: { count: 1, depth: 2, width: 8 } });
  assert.equal(world.organisms[0].id, id);
  assert.equal(world.tick, 0);
  assert.deepEqual(world.organisms[0].brains[0][0].slice(0, 6), original[0][0]);
  world.stepTick();
  const tick = world.tick;
  world.applyLiveSettings({ neural: { count: 1, depth: 1, width: 6 } });
  assert.equal(world.tick, tick);
  assert.deepEqual(world.organisms[0].brains, original);
  world.stepTick();
  assert(Math.abs(world.energyResidual()) < 1e-8);
});

test("raising a live budget resumes the same rejected tick", () => {
  const world = new PredatorWorld(24, undefined, 0,
    { prey: 0, food: 0, budgets: { organisms: 1 } });
  world.renewal = 0;
  world.schedule({ type: "introducePredators", value: 2, tick: 1 });
  assert.equal(world.stepTick(), null);
  assert.equal(world.tick, 0);
  world.applyLiveSettings({ budgets: { organisms: 2 } });
  assert.equal(world.limitDiagnostic, null);
  world.stepTick();
  assert.equal(world.tick, 1);
  assert.equal(world.organisms.length, 2);
});
