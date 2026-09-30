import test from "node:test";
import assert from "node:assert/strict";
import { PredatorWorld } from "../dist/sim/predator-world.js";
import { INPUTS, OBSERVATION_VERSION, parameterCount } from "../dist/sim/predator-neural.js";

function quietBrain(organism, turnBias = 0) {
  for (const network of organism.brains)
    for (const layer of network)
      for (const row of layer) row.fill(0);
  organism.brains[0].at(-1)[0][organism.brains[0].at(-1)[0].length - 1] = turnBias;
}

test("Goal turn node prefers food and escape using only visible observations", () => {
  const world = new PredatorWorld(73, { count: 1, depth: 1, width: 6 }, 1,
    { prey: 1, food: 0 });
  const prey = world.organisms.find((o) => o.role === "prey");
  const predator = world.organisms.find((o) => o.role === "predator");
  quietBrain(prey);
  Object.assign(prey, { x: 500, y: 350, angle: 0 });
  Object.assign(predator, { x: 900, y: 600 });
  world.food = [{ id: 999, x: 500, y: 430, energy: 29 }];
  let observation = world.sense(prey);
  assert.equal(observation.schemaVersion, OBSERVATION_VERSION);
  assert.equal(INPUTS.at(-1), "Goal turn");
  assert.equal(observation.goal.kind, "foraging");
  assert(observation.inputs.at(-1) > 0);
  world.control(prey, observation);
  assert(prey.control[0] > 0);
  assert(prey.control[1] >= -0.2 && prey.control[3] > 0);

  world.food = [];
  predator.x = 500; predator.y = 380;
  observation = world.sense(prey);
  assert.equal(observation.goal.kind, "escaping");
  assert(observation.inputs.at(-1) < 0);
  world.control(prey, observation);
  assert(prey.control[0] < 0);
  assert(!Object.hasOwn(observation.goal, "brains"));
  const hunt = world.sense(predator);
  assert.equal(hunt.goal.kind, "hunting");
  world.control(predator, hunt);
  assert(predator.control[2] > 0);
});

test("goal-guided neural movement closes distance to visible food", () => {
  const world = new PredatorWorld(76, { count: 1, depth: 1, width: 6 }, 0,
    { prey: 1, food: 0 });
  world.renewal = 0;
  const prey = world.organisms[0];
  Object.assign(prey, { x: 500, y: 350, angle: 0 });
  quietBrain(prey);
  world.food = [{ id: 999, x: 500, y: 430, energy: 29 }];
  world.ledger.initial = world.storedEnergy();
  const initialDistance = 80;
  for (let i = 0; i < 45; i++) world.stepTick();
  const distance = Math.hypot(world.organisms[0].x - 500, world.organisms[0].y - 430);
  assert(distance < initialDistance - 15, `food approach stalled at ${distance}`);
  assert(Math.abs(world.energyResidual()) < 1e-7);
});

test("a turn-biased network explores instead of tracing tight circles", () => {
  const world = new PredatorWorld(74, { count: 1, depth: 1, width: 6 }, 0,
    { prey: 1, food: 0 });
  world.renewal = 0;
  const prey = world.organisms[0];
  prey.x = 500; prey.y = 350;
  quietBrain(prey, 4);
  const start = { x: prey.x, y: prey.y };
  let traveled = 0;
  for (let i = 0; i < 180; i++) {
    const previous = { x: world.organisms[0].x, y: world.organisms[0].y };
    world.stepTick();
    traveled += Math.hypot(world.organisms[0].x - previous.x, world.organisms[0].y - previous.y);
  }
  const displacement = Math.hypot(world.organisms[0].x - start.x, world.organisms[0].y - start.y);
  assert(traveled > 20);
  assert(displacement / traveled > 0.75,
    `search path still circles: ${displacement / traveled}`);
});

test("older 22-input checkpoints retain their weights when goal input is added", () => {
  const world = new PredatorWorld(75, { count: 1, depth: 1, width: 6 }, 0,
    { prey: 1, food: 0 });
  const old = world.exportState();
  old.stateVersion = 2;
  for (const organism of old.organisms) {
    organism.inputLabels = INPUTS.slice(0, -1);
    organism.parameterCount -= 6;
    for (const network of organism.brains)
      for (const row of network[0]) row.splice(-2, 1);
  }
  old.parameters -= 6;
  const oldWeight = old.organisms[0].brains[0][0][0][0];
  const oldBias = old.organisms[0].brains[0][0][0].at(-1);
  const restored = PredatorWorld.restore(old);
  const organism = restored.organisms[0];
  assert.equal(restored.stateVersion, 3);
  assert.equal(organism.brains[0][0][0].at(-2), 0);
  assert.equal(organism.brains[0][0][0][0], oldWeight);
  assert.equal(organism.brains[0][0][0].at(-1), oldBias);
  assert.equal(organism.brains[0][0][0].length, INPUTS.length + 1);
  assert.equal(organism.parameterCount, parameterCount(restored.neural));
  assert.equal(organism.lastInputs, null);
  restored.stepTick();
  assert.equal(restored.organisms[0].lastInputs.length, INPUTS.length);
});
