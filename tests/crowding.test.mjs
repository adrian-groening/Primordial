import test from "node:test";
import assert from "node:assert/strict";
import { PlanetWorld } from "../dist/sim/planet-world.js";
import {
  bodyRadius,
  effectiveRadius,
  movementBlockers,
} from "../dist/sim/space.js";
import { distance, offset, tangent } from "../dist/sim/sphere.js";
test("crowded movement slides around contact while preserving hard clearance", () => {
  const w = new PlanetWorld(42),
    [a, b] = w.organisms;
  b.n = offset(a.n, 0, bodyRadius(a) + bodyRadius(b) + 0.3);
  const before = [...a.n];
  a.heading = tangent(a.n, b.n);
  a.control = [0, 1, -1, -1];
  b.control = [0, -1, -1, -1];
  w.tick = 1;
  w.renewal = 0;
  w.food = [];
  w.ledger = { initial: w.storedEnergy(), input: 0, heat: 0 };
  w.stepTick();
  assert(w.collisions > 0);
  assert(distance(before, a.n) > 0);
  assert(distance(a.n, b.n) >= effectiveRadius(a) + effectiveRadius(b) - 1e-6);
  assert(Math.abs(w.energyResidual()) < 1e-6);
});
test("temporary compression opens a narrow passage without coincident centers", () => {
  const w = new PlanetWorld(),
    [a, b] = w.organisms;
  b.n = offset(a.n, 0, bodyRadius(a) + bodyRadius(b) + 0.05);
  const close = offset(a.n, 0, 3);
  assert(movementBlockers(a, close, [a, b]).length > 0);
  a.compression = b.compression = 0.18;
  assert.equal(movementBlockers(a, close, [a, b]).length, 0);
  assert(effectiveRadius(a) >= bodyRadius(a) * 0.8);
});
test("healthy territorial rivals deliberately challenge while injured ones retreat", () => {
  const w = new PlanetWorld(),
    [a, b] = w.organisms;
  b.n = offset(a.n, 0, 90);
  a.traits.aggression = 1;
  b.traits.aggression = 0;
  a.energy = 140;
  w.random = () => 0;
  w.tick = 1;
  w.control(a, w.sense(a));
  assert.equal(a.mind.intent, "challenging");
  assert.equal(a.mind.hostileTo, b.id);
  w.ledger = { initial: w.storedEnergy(), input: 0, heat: 0 };
  w.resolveConflicts([[a, b]]);
  assert.equal(w.conflicts, 1);
  assert.equal(w.events.at(-1).type, "conflict");
  assert.equal(w.events.at(-1).receiverId, b.id);
  assert(Math.abs(w.energyResidual()) < 1e-6);
  w.tick += 30;
  a.health = 40;
  a.mind.fear = 0;
  w.control(a, w.sense(a));
  assert.equal(a.mind.intent, "retreating");
  assert.equal(a.mind.hostileTo, null);
  w.resolveConflicts([[a, b]]);
  assert.equal(w.conflicts, 1);
});
