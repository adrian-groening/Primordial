import test from "node:test";
import assert from "node:assert/strict";
import { PredatorWorld } from "../dist/sim/predator-world.js";
import { decide, INPUTS, OUTPUTS, OBSERVATION_VERSION } from "../dist/sim/predator-neural.js";

test("contested finite food enters guts and digestion balances heat", () => {
  const w = new PredatorWorld(4, undefined, 0, { prey: 2, food: 0 });
  w.renewal = 0;
  const [a, b] = w.organisms;
  for (const o of [a, b]) {
    o.x = o.y = 100;
    o.biteLimit = 8;
    o.digestionRate = 300;
    o.control = [0, 0, 0, 1, 1];
  }
  w.food = [{ id: 999, x: 100, y: 100, energy: 10 }];
  w.ledger = { initial: w.storedEnergy(), input: 0, heat: 0, costs: {} };
  const initialReserve = a.energy + b.energy;
  w.feed();
  assert.equal(a.gutEnergy + b.gutEnergy, 10);
  assert.equal(w.food.length, 0);
  assert.equal(a.energy + b.energy, initialReserve);
  w.digest();
  assert(Math.abs(a.energy + b.energy - initialReserve - 7.5) < 1e-10);
  assert(Math.abs(w.ledger.heat - 2.5) < 1e-10);
  assert(Math.abs(w.energyResidual()) < 1e-8);
});

test("field of view and missing masks apply equally to rule and neural observations", () => {
  const w = new PredatorWorld(6, undefined, 1, { prey: 1, food: 0, fovDegrees: 90 });
  const [prey, hunter] = w.organisms;
  prey.x = prey.y = 100;
  hunter.x = 120; hunter.y = 100;
  prey.angle = Math.PI;
  let observed = w.sense(prey);
  assert.equal(observed.schemaVersion, OBSERVATION_VERSION);
  assert.equal(observed.threat, null);
  assert.equal(observed.inputs[5], 0);
  prey.angle = 0;
  observed = w.sense(prey);
  assert.equal(observed.threat.id, hunter.id);
  assert.equal(observed.inputs[5], 1);
  assert(!Object.hasOwn(observed.threat, "brains"));
  assert(!Object.hasOwn(observed.threat, "parentId"));
});

test("hand-set neural turn and action outputs respond to visible lateral food", () => {
  const hidden = Array.from({ length: 2 }, () => Array(INPUTS.length + 1).fill(0));
  hidden[0][1] = 4;
  const output = Array.from({ length: OUTPUTS.length }, () => [0, 0, 0]);
  output[0][0] = 4;
  output[2][2] = 2;
  output[3][2] = 2;
  const brain = [[hidden, output]];
  const left = Array(INPUTS.length).fill(0);
  const right = Array(INPUTS.length).fill(0);
  left[1] = -0.5;
  right[1] = 0.5;
  const turnLeft = decide(brain, left, false).output;
  const turnRight = decide(brain, right, false).output;
  assert(turnLeft[0] < 0);
  assert(turnRight[0] > 0);
  assert(turnRight[2] > 0 && turnRight[3] > 0);
  assert.deepEqual(decide(brain, right, false).traces, []);
  assert.equal(decide(brain, right, true).traces[0][0].length, INPUTS.length);
});

test("stamina and armor constrain attacks without creating energy", () => {
  const w = new PredatorWorld(8, undefined, 1, { prey: 1, food: 0 });
  const [prey, hunter] = w.organisms;
  prey.x = hunter.x = 100;
  prey.y = hunter.y = 100;
  hunter.control = [0, 0, 1, 1, 1];
  hunter.stamina = 9;
  w.ledger = { initial: w.storedEnergy(), input: 0, heat: 0, costs: {} };
  w.resolveCombat();
  assert.equal(prey.health, 60);
  hunter.stamina = 100;
  prey.armor = 10;
  w.resolveCombat();
  assert.equal(prey.health, 40);
  assert.equal(hunter.stamina, 90);
  assert(Math.abs(w.energyResidual()) < 1e-8);
});
