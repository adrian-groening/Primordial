import test from "node:test";
import assert from "node:assert/strict";
import { PlanetWorld } from "../dist/sim/planet-world.js";
import {
  bodyRadius,
  territoryRadius,
  movementBlockers,
  hasSpace,
} from "../dist/sim/space.js";
import { offset, distance, tangent } from "../dist/sim/sphere.js";
function separated(w) {
  for (let i = 0; i < w.organisms.length; i++)
    for (let j = i + 1; j < w.organisms.length; j++) {
      const a = w.organisms[i],
        b = w.organisms[j];
      assert(
        distance(a.n, b.n) >= bodyRadius(a) + bodyRadius(b) - 1e-5,
        `${a.id} overlaps ${b.id}`,
      );
    }
}
test("two identical asexual founder lineages start in separate occupied spaces", () => {
  const w = new PlanetWorld(),
    [a, b] = w.organisms;
  assert.equal(w.organisms.length, 2);
  assert.equal(w.reproductionMode, "asexual");
  assert.deepEqual(a.dna, b.dna);
  assert.deepEqual(a.brains, b.brains);
  assert.notEqual(a.familyId, b.familyId);
  separated(w);
  for (const o of w.organisms) {
    o.energy = 150;
    o.control[3] = 1;
  }
  w.mutation = 0;
  w.ledger = { initial: w.storedEnergy(), input: 0, heat: 0 };
  w.mate();
  assert.equal(w.eggs.length, 2);
  assert(w.eggs.every((e) => e.parents.length === 1));
  w.tick = 180;
  w.hatch();
  separated(w);
  assert.equal(w.organisms.length, 4);
  assert(Math.abs(w.energyResidual()) < 1e-7);
});
test("swept collision rejects crossing occupied space even with an unoccupied endpoint", () => {
  const w = new PlanetWorld(),
    [a, b] = w.organisms;
  b.n = offset(a.n, 0, bodyRadius(a) + bodyRadius(b) + 1);
  const candidate = offset(a.n, 0, 200);
  assert(hasSpace(candidate, bodyRadius(a), [b]));
  assert.deepEqual(
    movementBlockers(a, candidate, [a, b]).map((o) => o.id),
    [b.id],
  );
  assert.equal(movementBlockers(a, offset(a.n, Math.PI, 10), [a, b]).length, 0);
});
test("territorial defense is energy-funded, armor-reduced and cooldown-limited", () => {
  const w = new PlanetWorld(),
    [a, b] = w.organisms;
  a.traits.aggression = 1;
  b.traits.aggression = 0;
  b.n = offset(a.n, 0, bodyRadius(a) + bodyRadius(b) + 0.02);
  a.territoryCenter = [...a.n];
  b.health = 100;
  const before = a.energy;
  w.ledger = { initial: w.storedEnergy(), input: 0, heat: 0 };
  w.resolveConflicts([[a, b]]);
  assert.equal(a.energy, before - 2);
  assert.equal(w.conflicts, 1);
  assert.equal(b.health, 100 - 10 * (1 - b.traits.armor * 0.6));
  w.resolveConflicts([[a, b]]);
  assert.equal(w.conflicts, 1);
  w.tick += 30;
  b.health = 1;
  w.resolveConflicts([[a, b]]);
  assert(b.dead);
  assert.equal(w.pedigree.get(b.id).cause, "conflict");
  assert.equal(w.deaths.conflict, 1);
  assert(Math.abs(w.energyResidual()) < 1e-7);
});
test("nonaggressive animals and defenders away from their territory do not strike", () => {
  const w = new PlanetWorld(),
    [a, b] = w.organisms;
  a.traits.aggression = b.traits.aggression = 0;
  w.resolveConflicts([[a, b]]);
  assert.equal(w.conflicts, 0);
  w.tick += 30;
  a.traits.aggression = 1;
  a.territoryCenter = offset(b.n, 0, 500);
  w.resolveConflicts([[a, b]]);
  assert.equal(w.conflicts, 0);
});
test("movement and newborn placement preserve exclusion over a reproducing run", () => {
  const w = new PlanetWorld();
  for (let i = 0; i < 1800; i++) {
    w.stepTick();
    separated(w);
  }
  assert(w.births > 0);
  assert(w.collisions > 0);
  assert(
    [...w.pedigree.values()].filter((o) => !o.parents.length).length === 2,
  );
  assert(
    [...w.pedigree.values()]
      .filter((o) => o.parents.length)
      .every((o) => o.parents.length === 1),
  );
  assert(Math.abs(w.energyResidual()) < 1e-5);
});
