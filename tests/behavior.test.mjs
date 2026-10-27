import test from "node:test";
import assert from "node:assert/strict";
import { PlanetWorld } from "../dist/sim/planet-world.js";
import {
  chooseBehavior,
  rememberDanger,
  updateMind,
} from "../dist/sim/behavior.js";
import { offset } from "../dist/sim/sphere.js";
function lone() {
  const w = new PlanetWorld(42, { count: 0, depth: 1, width: 6 }, 1);
  const o = w.organisms[0];
  w.organisms = [o];
  w.ledger = { initial: w.storedEnergy(), input: 0, heat: 0 };
  return { w, o };
}
const perception = (more = {}) => ({
  food: null,
  threat: null,
  neighbor: null,
  mate: null,
  ...more,
});
test("immediate danger overrides neural steering, predatory attack, and reproduction", () => {
  const { w, o } = lone();
  o.energy = 160;
  const threat = { id: 987, n: offset(o.n, 0, 35) };
  const snapshot = chooseBehavior(o, perception({ threat }), w, [1, -1, 1, 1]);
  assert.equal(snapshot.intent, "escaping");
  assert.equal(o.control[1], 1);
  assert.equal(o.control[2], -1);
  assert.equal(o.control[3], -1);
  rememberDanger(o, threat, w.tick, 0.9);
  assert.equal(o.mind.lastEncounterId, threat.id);
  assert(o.mind.fear >= 0.9);
  updateMind(o, 1, 0);
  assert(o.mind.fear < 0.9);
});
test("injury and fatigue enforce rest; recovery has an energy cost", () => {
  const { w, o } = lone();
  o.health = 50;
  o.energy = 110;
  w.renewal = 0;
  w.food = [];
  w.ledger = { initial: w.storedEnergy(), input: 0, heat: 0 };
  const snapshot = chooseBehavior(o, perception(), w, [1, 1, 1, 1]);
  assert.equal(snapshot.intent, "resting");
  assert.equal(o.control[1], -1);
  assert.equal(o.control[3], -1);
  const startHealth = o.health;
  for (let i = 0; i < 30; i++) w.stepTick();
  assert(o.health > startHealth);
  assert(o.mind.fatigue < 0.1);
  assert(Math.abs(w.energyResidual()) < 1e-7);
});
test("hunger still directs neural organisms toward food while safe curiosity can deviate", () => {
  const { w, o } = lone();
  o.energy = 25;
  const food = { id: 999, n: offset(o.n, 0, 60) };
  let decision = chooseBehavior(o, perception({ food }), w, [-1, -1, -1, -1]);
  assert.equal(decision.intent, "foraging");
  assert(o.control[1] > -1);
  o.energy = 120;
  w.random = () => 0;
  decision = chooseBehavior(o, perception(), w, null);
  assert.equal(decision.intent, "investigating");
  assert.equal(o.mind.deviations, 1);
});
test("same seed produces matching stateful decisions and descendants over time", () => {
  const a = new PlanetWorld(8128),
    b = new PlanetWorld(8128);
  for (let i = 0; i < 1800; i++) {
    a.stepTick();
    b.stepTick();
  }
  assert.deepEqual(a.organisms, b.organisms);
  assert.deepEqual(a.events, b.events);
  assert(a.births > 0);
  assert(a.organisms.some((o) => o.mind.deviations > 0));
  assert(Math.abs(a.energyResidual()) < 1e-5);
});

test("familiar neighbors can trigger a sparse, energy-funded signal", () => {
  const w = new PlanetWorld(88),
    [a, b] = w.organisms;
  b.familyId = a.familyId;
  b.n = offset(a.n, 0, 95);
  a.energy = a.capacity;
  w.ledger = { initial: w.storedEnergy(), input: 0, heat: 0 };
  w.random = () => 0;
  w.tick = 1;
  w.control(a, w.sense(a));
  assert.equal(a.mind.intent, "approaching");
  assert.equal(w.encounters, 1);
  assert.equal(w.events.at(-1).type, "signal");
  assert.equal(a.mind.lastEncounterId, b.id);
  w.control(a, w.sense(a));
  assert.equal(w.encounters, 1);
  assert(Math.abs(w.energyResidual()) < 1e-7);
});
