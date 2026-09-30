import test from "node:test";
import assert from "node:assert/strict";
import { PredatorWorld, TICK_SECONDS } from "../dist/sim/predator-world.js";
import {
  architecture,
  parameterCount,
  INPUTS,
  OUTPUTS,
} from "../dist/sim/predator-neural.js";
function arena(hunters = 1) {
  const w = new PredatorWorld(42, undefined, hunters);
  w.organisms = [
    w.organisms[0],
    ...w.organisms.filter((o) => o.role === "predator"),
  ];
  w.food = [];
  w.renewal = 0;
  for (const o of w.organisms)
    Object.assign(o, { x: 100, y: 100, angle: 0, control: [0, 0, 1] });
  return w;
}
function resetLedger(w) {
  w.ledger = { initial: w.storedEnergy(), input: 0, heat: 0 };
}
function balance(w) {
  assert(
    Math.abs(w.energyResidual()) < 1e-6,
    `Energy residual ${w.energyResidual()}`,
  );
}

test("default founders and predator count validation", () => {
  const w = new PredatorWorld();
  assert.equal(w.organisms.filter((o) => o.role === "prey").length, 80);
  assert.equal(w.organisms.filter((o) => o.role === "predator").length, 8);
  for (const n of [-1, 31, 0.5, NaN, Infinity, "8"])
    assert.throws(() => new PredatorWorld(42, undefined, n));
});
test("attack reach, neural intent, energy and cooldown constrain damage", () => {
  const w = arena(),
    [prey, hunter] = w.organisms;
  prey.x = 150;
  w.resolveCombat();
  assert.equal(prey.health, 60);
  prey.x = 100;
  hunter.control[2] = -1;
  w.resolveCombat();
  assert.equal(prey.health, 60);
  hunter.control[2] = 1;
  hunter.energy = 1;
  w.resolveCombat();
  assert.equal(prey.health, 60);
  hunter.energy = 130;
  w.resolveCombat();
  assert.equal(prey.health, 30);
  assert.equal(hunter.energy, 128);
  assert.equal(w.attacks, 1);
  w.resolveCombat();
  assert.equal(prey.health, 30);
  w.tick = 15;
  w.resolveCombat();
  assert(prey.dead);
  assert.equal(w.kills, 1);
});
test("simultaneous hunters produce one finite carcass and receive no kill bonus", () => {
  const w = arena(2),
    [prey, a, b] = w.organisms;
  resetLedger(w);
  const preyEnergy = prey.energy + prey.tissueEnergy;
  w.resolveCombat();
  assert(prey.dead);
  assert.equal(w.kills, 1);
  assert.equal(w.carcasses.length, 1);
  assert.equal(w.carcasses[0].energy, preyEnergy);
  assert.equal(a.energy, 128);
  assert.equal(b.energy, 128);
  balance(w);
  w.resolveCombat();
  assert.equal(w.carcasses.length, 1);
  w.die(prey, "predation");
  assert.equal(w.kills, 1);
  w.carcasses[0].energy = 1;
  resetLedger(w);
  const before = a.energy + b.energy + a.gutEnergy + b.gutEnergy;
  w.feed();
  assert.equal(a.energy + b.energy + a.gutEnergy + b.gutEnergy - before, 1);
  assert.equal(w.carcasses.length, 0);
  balance(w);
});
test("dead prey cannot eat or reproduce and carcass accounting balances", () => {
  const w = arena(),
    prey = w.organisms[0];
  prey.health = 30;
  prey.age = 20;
  prey.energy = 160;
  w.food = [{ id: 999, x: 100, y: 100, energy: 29 }];
  resetLedger(w);
  w.resolveCombat();
  w.feed();
  w.reproduce();
  assert.equal(w.food[0].energy, 29);
  assert.equal(w.births, 0);
  assert(!w.organisms.includes(prey));
  balance(w);
});
test("feeding contests do not depend on entity array order", () => {
  const a = arena(3),
    b = arena(3);
  for (const w of [a, b]) {
    w.organisms = w.organisms.filter((o) => o.role === "predator");
    w.carcasses = [{ id: 999, x: 100, y: 100, role: "prey", energy: 3 }];
    resetLedger(w);
  }
  b.organisms.reverse();
  a.feed();
  b.feed();
  const summary = (w) =>
    w.organisms.map((o) => [o.id, o.energy]).sort((x, y) => x[0] - y[0]);
  assert.deepEqual(summary(a), summary(b));
  balance(a);
  balance(b);
});
test("prey flees local predators while hunters pursue local prey", () => {
  const w = arena(),
    [prey, hunter] = w.organisms;
  prey.x = 120;
  hunter.x = 150;
  const observation = w.sense(prey);
  assert.equal(observation.threat.id, hunter.id);
  w.control(prey, observation);
  assert.equal(prey.action, "fleeing");
  assert(Math.abs(prey.control[0]) > 0);
  w.control(hunter, w.sense(hunter));
  assert.equal(hunter.action, "hunting");
  assert.equal(hunter.control[2], 1);
  hunter.x = 900;
  assert.equal(w.sense(prey).threat, null);
});
test("post-movement contact determines attacks", () => {
  const w = arena(),
    [prey, hunter] = w.organisms;
  w.tick = 1;
  prey.x = 116.5;
  hunter.x = 100;
  prey.control = [0, -1, -1];
  hunter.control = [0, 1, 1];
  hunter.speed = 60;
  prey.size = 4;
  hunter.size = 8;
  prey.health = 20;
  // Initial separation 16.5, reach 15: acceleration brings them into contact.
  for (let i = 0; i < 4; i++) w.stepTick();
  assert.equal(w.kills, 1);
});
test("predators cannot eat nutrient particles or predator carcasses", () => {
  const w = arena();
  w.organisms = w.organisms.filter((o) => o.role === "predator");
  const hunter = w.organisms[0];
  w.food = [{ id: 999, x: 100, y: 100, energy: 29 }];
  w.carcasses = [{ id: 1000, x: 100, y: 100, role: "predator", energy: 100 }];
  const before = hunter.energy;
  w.feed();
  assert.equal(hunter.energy, before);
  assert.equal(w.food[0].energy, 29);
  assert.equal(w.carcasses[0].energy, 100);
});
test("desperate predators hunt and eat other predators without creating energy", () => {
  const w = new PredatorWorld(42, undefined, 2, { prey: 0, food: 0 });
  w.renewal = 0;
  const [hunter, victim] = w.organisms;
  Object.assign(hunter, { x: 100, y: 100, angle: 0, energy: 70 });
  Object.assign(victim, { x: 126, y: 100, angle: Math.PI });
  resetLedger(w);
  const observation = w.sense(hunter);
  assert.equal(observation.food.id, victim.id);
  assert.equal(observation.goal.kind, "hunting");
  w.control(hunter, observation);
  assert(hunter.control[2] > 0);
  for (let i = 0; i < 4; i++) {
    w.tick = i * 15;
    w.resolveCombat();
  }
  assert(victim.dead);
  assert.equal(w.cannibalKills, 1);
  assert.equal(w.kills, 1);
  assert.equal(w.carcasses[0].role, "predator");
  hunter.x = victim.x; hunter.y = victim.y;
  const remains = w.carcasses[0].energy;
  w.feed();
  assert(hunter.gutEnergy > 0);
  assert(w.carcasses[0].energy < remains);
  w.digest();
  balance(w);
});
test("prey remains the preferred target when cannibalism is possible", () => {
  const w = new PredatorWorld(42, undefined, 2, { prey: 1, food: 0 });
  const [prey, hunter, other] = w.organisms;
  Object.assign(hunter, { x: 100, y: 100, energy: 70, control: [0, 0, 1, 1, 1] });
  Object.assign(prey, { x: 120, y: 100 });
  Object.assign(other, { x: 125, y: 100 });
  assert.equal(w.sense(hunter).food.id, prey.id);
  w.resolveCombat();
  assert(prey.health < prey.maxHealth);
  assert.equal(other.health, other.maxHealth);
});
test("neural predators receive a hunting goal when starving beside a predator", () => {
  const w = new PredatorWorld(42, { count: 1, depth: 1, width: 6 }, 2,
    { prey: 0, food: 0 });
  const [hunter, victim] = w.organisms;
  Object.assign(hunter, { x: 100, y: 100, angle: 0, energy: 70 });
  Object.assign(victim, { x: 140, y: 100 });
  const observation = w.sense(hunter);
  assert.equal(observation.food.id, victim.id);
  w.control(hunter, observation);
  assert.equal(hunter.action, "hunting");
  assert(hunter.control[2] > 0);
});
test("hungry predators scavenge nearby remains before attacking each other", () => {
  const w = new PredatorWorld(42, undefined, 2, { prey: 0, food: 0 });
  const [hunter, other] = w.organisms;
  Object.assign(hunter, { x: 100, y: 100, energy: 70, control: [0, 0, 1, 1, 1] });
  Object.assign(other, { x: 125, y: 100 });
  w.carcasses = [{ id: 999, sourceId: 998, role: "predator", x: 100, y: 100, energy: 20 }];
  resetLedger(w);
  assert.equal(w.sense(hunter).food.id, 999);
  w.resolveCombat();
  assert.equal(other.health, other.maxHealth);
  w.feed();
  assert(hunter.gutEnergy > 0);
  balance(w);
});
test("older predator checkpoints gain a zero cannibal count", () => {
  const w = new PredatorWorld(42, undefined, 2, { prey: 0, food: 0 });
  const state = w.exportState();
  delete state.cannibalKills;
  const restored = PredatorWorld.restore(state);
  assert.equal(restored.cannibalKills, 0);
  restored.stepTick();
  assert.equal(restored.cannibalKills, 0);
});
test("predators starve without edible prey or carrion", () => {
  const w = arena();
  w.organisms = w.organisms.filter((o) => o.role === "predator");
  resetLedger(w);
  for (let i = 0; i < 6000; i++) w.stepTick();
  assert.equal(w.organisms.length, 0);
  assert.equal(w.births, 0);
  assert.equal(w.deaths.starvation, 1);
  balance(w);
});
test("predator reproduction inherits role and independent genomes with funded energy", () => {
  const w = new PredatorWorld(42, { count: 1, depth: 1, width: 6 }, 1);
  w.organisms = w.organisms.filter((o) => o.role === "predator");
  const parent = w.organisms[0];
  parent.age = 20;
  parent.energy = 200;
  w.mutation = 0;
  resetLedger(w);
  w.reproduce();
  const child = w.organisms[1];
  assert.equal(child.role, "predator");
  assert.equal(child.parentId, parent.id);
  assert.equal(child.age, 0);
  assert.equal(child.energy, 55);
  assert.equal(parent.energy, 110);
  assert.deepEqual(child.brains, parent.brains);
  assert.notEqual(child.brains, parent.brains);
  balance(w);
  w.reproduce();
  assert.equal(w.births, 1);
});
test("23 input / 5 output neural architecture works for both roles", () => {
  assert.equal(INPUTS.length, 23);
  assert.equal(OUTPUTS.length, 5);
  assert.deepEqual(architecture({ count: 1, depth: 1, width: 6 }), [23, 6, 5]);
  assert.equal(parameterCount({ count: 1, depth: 1, width: 6 }), 179);
  for (const config of [
    { count: 1, depth: 1, width: 6 },
    { count: 4, depth: 3, width: 12 },
  ]) {
    const w = new PredatorWorld(42, config);
    for (let i = 0; i < 60; i++) w.stepTick();
    assert(w.organisms.length > 0);
    for (const role of ["prey", "predator"]) {
      const o = w.organisms.find((o) => o.role === role);
      assert(o);
      assert.equal(o.lastInputs.length, 23);
      assert.equal(o.traces.length, 0);
      assert.equal(o.control.length, 5);
      assert(o.control.every(Number.isFinite));
    }
    balance(w);
  }
});
test("fixed ticks are invariant to render dt partitioning", () => {
  const a = new PredatorWorld(42),
    b = new PredatorWorld(42);
  for (let i = 0; i < 600; i++) a.step(TICK_SECONDS);
  for (let i = 0; i < 1200; i++) b.step(1 / 60);
  assert.equal(a.tick, 600);
  assert.equal(b.tick, 600);
  assert.deepEqual(a.organisms, b.organisms);
  assert.deepEqual(a.food, b.food);
  assert.deepEqual(a.ledger, b.ledger);
});
test("default rule run hunts and reproduces with closed transfer accounting", () => {
  const w = new PredatorWorld();
  for (let i = 0; i < 1800; i++) w.stepTick();
  assert(w.kills > 0);
  assert(w.organisms.some((o) => o.role === "predator" && o.generation > 1));
  assert(w.births > 0);
  balance(w);
  assert(
    w.organisms.every(
      (o) =>
        o.energy >= 0 &&
        o.health > 0 &&
        Number.isFinite(o.x) &&
        Number.isFinite(o.y),
    ),
  );
});
test("zero-predator run remains predator-free", () => {
  const w = new PredatorWorld(90210, undefined, 0);
  for (let i = 0; i < 300; i++) w.stepTick();
  assert.equal(w.kills, 0);
  assert(w.organisms.every((o) => o.role === "prey"));
  balance(w);
});
