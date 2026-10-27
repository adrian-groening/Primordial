import test from "node:test";
import assert from "node:assert/strict";
import { EvolvingWorld } from "../dist/sim/evolving-world.js";
import { PredatorWorld } from "../dist/sim/predator-world.js";
import { DEFAULT_NEURAL, INPUTS, OUTPUTS, createBrains, decide, teach } from "../dist/sim/evolving-neural.js";
import { drawUint32 } from "../dist/sim/random.js";
import { beginFoodComparison, advanceFoodComparison } from "../dist/sim/decision-lab.js";
import { controlSnapshot } from "../scripts/simulation-snapshot.mjs";

function fixedPolicy(o, outputs) {
  for (const net of o.brains) {
    for (const layer of net) for (const row of layer) row.fill(0);
    net.at(-1).forEach((row, i) => { row[row.length - 1] = Math.atanh(outputs[i] ?? -0.8); });
  }
}
test("every evolving founder has a neural genome; rule-only runs and invalid learning settings are rejected", () => {
  const w = new EvolvingWorld();
  assert.deepEqual(w.neural, DEFAULT_NEURAL);
  assert(w.organisms.every((o) => o.brains.length === 1 && o.genome.length === 1));
  assert.equal(INPUTS.length, 37); assert.equal(OUTPUTS.length, 14);
  assert.throws(() => new EvolvingWorld(1, { count: 0, depth: 1, width: 6 }), /at least one/);
  assert.throws(() => w.applyLiveSettings({ neural: { count: 0, depth: 1, width: 6 } }), /at least one/);
  const before = w.stateKey();
  assert.throws(() => w.applyLiveSettings({ intelligence: { enabled: "yes" } }), /boolean/);
  assert.throws(() => w.applyLiveSettings({ nonexistent: true }), /Unknown/);
  assert.equal(w.stateKey(), before);
});
test("experience changes policy weights during life while the starting genome stays unchanged", () => {
  const w = new EvolvingWorld(90210, undefined, 0, { prey: 1 });
  const o = w.organisms[0], genome = JSON.stringify(o.genome), initial = JSON.stringify(o.brains);
  for (let tick = 0; tick < 90; tick++) w.stepTick();
  assert.notEqual(JSON.stringify(o.brains), initial);
  assert.equal(JSON.stringify(o.genome), genome);
  assert(o.mind.updates > 0 && o.mind.weightChange > 0);
  assert(o.mind.memory.some((v) => Math.abs(v) > 0.001));
  assert(o.mind.memory.every((v) => Number.isFinite(v) && Math.abs(v) <= 1));
  assert(Math.abs(w.energyResidual()) < 1e-6);
});
test("disabling learning freezes weights while still using neural inference", () => {
  const w = new EvolvingWorld(91, undefined, 0, { prey: 1, intelligence: { enabled: false } });
  const initial = JSON.stringify(w.organisms[0].brains);
  for (let tick = 0; tick < 60; tick++) w.stepTick();
  assert.equal(JSON.stringify(w.organisms[0].brains), initial);
  assert.equal(w.organisms[0].mind.updates, 0);
  assert.equal(w.organisms[0].lastInputs.length, 37);
});
test("a trained neural policy responds correctly to held-out food directions", () => {
  let seed = 42;
  const random = () => { const draw = drawUint32(seed); seed = draw.state; return draw.value; };
  const brains = createBrains(DEFAULT_NEURAL, random);
  const example = (lateral) => {
    const inputs = Array(INPUTS.length).fill(0); inputs[0] = 0.4; inputs[1] = lateral;
    inputs[2] = 1; inputs[6] = 0; inputs[7] = 1; inputs[22] = lateral;
    const target = [lateral, 0.6, -0.8, 0.9, -0.6, -0.7, -0.7, 0.6, -0.8, -0.8, 0.4, lateral, 0, 0];
    return { inputs, target };
  };
  const loss = () => [-0.6, 0.6].reduce((total, lateral) => {
    const { inputs, target } = example(lateral), result = decide(brains, inputs).output;
    return total + result.reduce((sum, value, i) => sum + (value - target[i]) ** 2, 0);
  }, 0);
  const before = loss();
  for (let i = 0; i < 800; i++) {
    const { inputs, target } = example(i % 2 ? 0.8 : -0.8);
    teach(brains, inputs, target, 0.02);
  }
  assert(loss() < before * 0.15);
  assert(decide(brains, example(-0.6).inputs).output[0] < -0.25);
  assert(decide(brains, example(0.6).inputs).output[0] > 0.25);
});
test("memory points only to previously observed food and expires without hidden-world access", () => {
  const w = new EvolvingWorld(21, undefined, 0, { prey: 1, food: 0, width: 500, height: 500 });
  const o = w.organisms[0]; Object.assign(o, { x: 250, y: 250, angle: 0 });
  w.food.push({ id: 999, x: 300, y: 250, energy: 29 });
  assert(w.sense(o).food);
  w.food = [{ id: 1000, x: 0, y: 0, energy: 29 }];
  const remembered = w.sense(o);
  assert.equal(remembered.food, null);
  assert.equal(remembered.goal.kind, "remembered foraging");
  assert.equal(o.mind.foodMemory.x, 300);
  w.tick = 1000;
  assert.equal(w.sense(o).inputs[33], 0);
  assert.equal(o.mind.foodMemory, null);
});
test("offspring inherit and independently mutate starting brains and ability genes, not a parent's experience", () => {
  const w = new EvolvingWorld(4, undefined, 0, { prey: 1, food: 0 });
  const parent = w.organisms[0]; w.mutation = 0;
  parent.brains[0][0][0][0] = 3.9; parent.mind.memory = [1, 1, 1, 1];
  const child = w.create("prey", parent);
  assert.deepEqual(child.genome, parent.genome);
  assert.deepEqual(child.genes, parent.genes);
  assert.deepEqual(child.brains, parent.genome);
  assert.deepEqual(child.mind.memory, [0, 0, 0, 0]);
  child.brains[0][0][0][0] = -3.9;
  assert.notEqual(child.brains[0][0][0][0], parent.genome[0][0][0][0]);
  w.mutation = 100;
  const mutant = w.create("prey", parent);
  assert.notDeepEqual(mutant.genes, parent.genes);
  assert.notDeepEqual(mutant.genome, parent.genome);
  assert(mutant.genes.dash >= 0.2 && mutant.genes.dash <= 1);
  assert(w.abilityStats.variants > 0);
});
test("dash, shield, signaling, camouflage and rest have physical consequences and paid costs", () => {
  const w = new EvolvingWorld(42, undefined, 1, { prey: 2, food: 0, intelligence: { enabled: false } });
  const [prey, friend, hunter] = w.organisms;
  Object.assign(prey, { x: 500, y: 500, angle: 0, energy: 150 });
  Object.assign(friend, { x: 530, y: 500 }); Object.assign(hunter, { x: 570, y: 500 });
  w.tick = 1; w.ledger.initial = w.storedEnergy();
  fixedPolicy(prey, [0, 0.8, -0.8, -0.8, -0.8, 0.8, 0.8, 0.8, -0.8, 0.8]);
  const energy = prey.energy, stamina = prey.stamina;
  w.control(prey, w.sense(prey));
  assert(w.movementSpeed(prey) > prey.speed);
  assert(prey.armor > 0);
  assert(prey.energy < energy && prey.stamina < stamina);
  assert(prey.abilities.signal);
  assert(w.sense(friend).signal);
  assert.equal(w.canDetect(hunter, prey, hunter.sense ** 2), false);
  assert.equal(w.canDetect(hunter, prey, 20 ** 2), true);
  assert(Math.abs(w.energyResidual()) < 1e-6);
  hunter.x = 900; prey.stamina = 10;
  fixedPolicy(prey, [0, 0.8, -0.8, -0.8, -0.8, -0.8, -0.8, -0.8, 0.8, -0.8]);
  w.tick = 20; w.control(prey, w.sense(prey));
  assert(w.movementSpeed(prey) < prey.speed * 0.1);
  assert(prey.abilities.used.rest > 0);
});
test("checkpoints replay learning, memories, abilities and RNG exactly; Decision lab keeps the live run unchanged", () => {
  const w = new EvolvingWorld(39, undefined, 2, { prey: 10, food: 30 });
  for (let i = 0; i < 90; i++) w.stepTick();
  const restored = EvolvingWorld.restore(w.exportState());
  for (let i = 0; i < 180; i++) { w.stepTick(); restored.stepTick(); }
  assert.equal(restored.stateKey(), w.stateKey());
  const before = w.stateKey(), comparison = beginFoodComparison(w, 12);
  advanceFoodComparison(comparison, 12);
  assert(comparison.done);
  assert.equal(w.stateKey(), before);
  const snapshot = controlSnapshot(w, {}, { selectedId: w.organisms[0].id });
  assert(snapshot.selected.mind.updates > 0);
  assert(!snapshot.selected.genome && !snapshot.selected.mind.transition);
  assert.equal(w.stateKey(), before);
});
test("legacy checkpoints migrate to neural learning without losing time, positions or energy", () => {
  const old = new PredatorWorld(22, undefined, 0, { prey: 1 });
  old.stepTick(); const energy = old.storedEnergy();
  const migrated = EvolvingWorld.restore(old.exportState());
  assert.equal(migrated.tick, old.tick);
  assert.equal(migrated.organisms[0].x, old.organisms[0].x);
  assert.equal(migrated.storedEnergy(), energy);
  assert.equal(migrated.modelVersion, "predator-v3");
  assert(migrated.neural.count > 0);
  migrated.stepTick();
  assert(Math.abs(migrated.energyResidual()) < 1e-6);
});

test("technical-limit rollback includes learned weights, memory and learning RNG", () => {
  const make = (budget) => {
    const w = new EvolvingWorld(8, undefined, 0, { prey: 1, food: 0, budgets: { organisms: budget } });
    w.schedule({ type: "introducePredators", value: 1, tick: 1 }); return w;
  };
  const limited = make(1), before = limited.stateKey();
  assert.equal(limited.stepTick(), null);
  assert.equal(limited.stateKey(), before);
  limited.raiseBudget("organisms", 2);
  const reference = make(2);
  limited.stepTick(); reference.stepTick();
  assert.equal(limited.stateKey(), reference.stateKey());
});

test("live architecture edits preserve learned and starting weights separately", () => {
  const w = new EvolvingWorld(12, { count: 1, depth: 1, width: 6 }, 0, { prey: 2 });
  for (let i = 0; i < 12; i++) w.stepTick();
  const o = w.organisms[0], learned = o.brains[0][0][0][0], inherited = o.genome[0][0][0][0];
  const tick = w.tick;
  w.applyLiveSettings({ neural: { count: 2, depth: 3, width: 12 } });
  assert.equal(w.tick, tick);
  assert.equal(w.organisms[0].brains[0][0][0][0], learned);
  assert.equal(w.organisms[0].genome[0][0][0][0], inherited);
  assert.equal(w.organisms[0].mind.transition, null);
  w.stepTick();
  assert(Math.abs(w.energyResidual()) < 1e-6);
});
