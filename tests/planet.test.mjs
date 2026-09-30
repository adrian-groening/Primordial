import test from "node:test";
import assert from "node:assert/strict";
import { PlanetWorld, DT } from "../dist/sim/planet-world.js";
import {
  express,
  GENES,
  inheritDNA,
  feedingRole,
  budDNA,
} from "../dist/sim/genetics.js";
import {
  norm,
  dot,
  distance,
  walk,
  basis,
  offset,
} from "../dist/sim/sphere.js";
import { bodyRadius } from "../dist/sim/space.js";
import { habitat, renderRadius } from "../dist/sim/terrain.js";
import { parameterCount, architecture } from "../dist/sim/planet-neural.js";
function pair(role = "prey", neural = { count: 0, depth: 1, width: 6 }) {
  const w = new PlanetWorld(42, neural, 2);
  for (const o of w.organisms) {
    o.role = role;
    o.dna.diet = role === "predator" ? [0.8, 0.8] : [0.45, 0.45];
    o.traits = express(o.dna);
  }
  w.reproductionMode = "sexual";
  const [a, b] = w.organisms;
  b.n = offset(a.n, 0, bodyRadius(a) + bodyRadius(b) + 0.1);
  for (const o of [a, b]) {
    o.age = 20;
    o.energy = 170;
    o.health = 100;
    o.mateAfter = 0;
    o.control = [0, 0, 1, 1];
  }
  a.sex = "F";
  b.sex = "M";
  w.ledger = { initial: w.storedEnergy(), input: 0, heat: 0 };
  return w;
}
function balance(w) {
  assert(
    Math.abs(w.energyResidual()) < 1e-5,
    `Unbalanced ${w.energyResidual()}`,
  );
}
test("sexual reproduction needs two compatible, mature, fed adults at contact", () => {
  for (const defect of [
    "alone",
    "juvenile",
    "hungry",
    "same-sex",
    "far",
    "cooldown",
    "neural-refusal",
  ]) {
    const w = pair(),
      [a, b] = w.organisms;
    if (defect === "alone") w.organisms = [a];
    if (defect === "juvenile") b.age = 1;
    if (defect === "hungry") b.energy = 20;
    if (defect === "same-sex") b.sex = "F";
    if (defect === "far") b.n = offset(a.n, 0, 200);
    if (defect === "cooldown") b.mateAfter = 100;
    if (defect === "neural-refusal") b.control[3] = -1;
    w.mate();
    assert(
      w.eggs.every((e) => e.parents.length === 1),
      defect,
    );
  }
});
test("both parents fund incubation and offspring retain pedigree after parent death", () => {
  const w = pair(),
    [a, b] = w.organisms;
  w.mutation = 0;
  w.mate();
  assert.equal(w.eggs.length, 1);
  assert.equal(a.energy, 125);
  assert.equal(b.energy, 125);
  assert.equal(w.births, 0);
  assert.equal(w.conceptions, 1);
  balance(w);
  w.hatch();
  assert.equal(w.organisms.length, 2);
  w.die(a, "age");
  w.organisms = w.organisms.filter((o) => !o.dead);
  w.tick = 180;
  w.hatch();
  const child = w.organisms.find((o) => o.parents.length);
  assert(child);
  assert.deepEqual(child.parents, [a.id, b.id]);
  assert.equal(child.generation, 2);
  assert.equal(child.age, 0);
  assert.equal(child.energy, 55);
  assert.equal(child.familyId, a.familyId);
  assert(w.pedigree.get(a.id).offspring.includes(child.id));
  assert.equal(w.pedigree.get(a.id).cause, "age");
  assert.equal(w.births, 1);
  balance(w);
  for (const key of Object.keys(GENES)) {
    assert(a.dna[key].includes(child.dna[key][0]));
    assert(b.dna[key].includes(child.dna[key][1]));
  }
});
test("hunters mate and inherit complete network modules without aliasing", () => {
  const w = pair("predator", { count: 2, depth: 1, width: 6 }),
    [a, b] = w.organisms;
  w.mutation = 0;
  w.mate();
  w.tick = 180;
  w.hatch();
  const child = w.organisms.at(-1);
  assert.equal(child.role, "predator");
  assert.equal(child.brains.length, 2);
  for (let i = 0; i < 2; i++) {
    assert(
      [JSON.stringify(a.brains[i]), JSON.stringify(b.brains[i])].includes(
        JSON.stringify(child.brains[i]),
      ),
    );
    assert.notEqual(child.brains[i], a.brains[i]);
    assert.notEqual(child.brains[i], b.brains[i]);
  }
  balance(w);
});
test("same-family founders may mate but parents and shared-parent siblings cannot", () => {
  const w = pair(),
    [a, b] = w.organisms;
  assert(w.compatible(a, b));
  a.parents = [101, 102];
  b.parents = [101, 103];
  assert(!w.compatible(a, b));
  b.parents = [a.id, 104];
  assert(!w.compatible(a, b));
});
test("mutation affects inherited alleles within bounds without rewriting parents", () => {
  const w = pair(),
    [a, b] = w.organisms,
    before = JSON.stringify([a.dna, b.dna]);
  const result = inheritDNA(a.dna, b.dna, () => 0.25, 100);
  assert(result.mutations.length > 0);
  assert.equal(JSON.stringify([a.dna, b.dna]), before);
  for (const [key, g] of Object.entries(GENES))
    assert(result.dna[key].every((v) => v >= g.min && v <= g.max));
});
test("high oxygen selects tolerance and does not rewrite adult DNA", () => {
  const w = pair(),
    [sensitive, adapted] = w.organisms;
  for (const o of [sensitive, adapted]) {
    o.dna.oxygen = [21, 21];
    o.dna.tolerance = [5, 5];
    o.dna.temperature = [24, 24];
    o.traits = express(o.dna);
    o.traits.aggression = 0;
    o.traits.swim = 1;
    o.mateAfter = 10000;
  }
  adapted.dna.oxygen = [40, 40];
  adapted.traits = express(adapted.dna);
  w.setEnvironment("oxygen", 40);
  assert.equal(w.oxygenStress(adapted), 0);
  assert.equal(w.oxygenStress(sensitive), 14);
  const dna = JSON.stringify(adapted.dna);
  for (let i = 0; i < 600; i++) w.stepTick();
  assert(w.pedigree.get(sensitive.id).deathTick !== null);
  assert.equal(w.pedigree.get(sensitive.id).cause, "oxygen");
  assert(w.organisms.some((o) => o.id === adapted.id));
  assert.equal(JSON.stringify(adapted.dna), dna);
});
test("low oxygen also causes stress, valid environmental edits are recorded", () => {
  const w = pair();
  w.setEnvironment("oxygen", 0);
  assert(w.oxygenStress(w.organisms[0]) > 0);
  assert.deepEqual(w.interventions.at(-1), {
    tick: 0,
    key: "oxygen",
    value: 0,
  });
  for (const [key, value] of [
    ["oxygen", 61],
    ["oxygen", NaN],
    ["temperature", 100],
    ["seaLevel", 0],
    ["fertility", 101],
    ["other", 1],
  ])
    assert.throws(() => w.setEnvironment(key, value));
});
test("terrain controls change geometry, water, movement and production", () => {
  const w = pair(),
    n = w.homes[0],
    oldRadius = renderRadius(n, w.environment);
  w.setEnvironment("ruggedness", 100);
  assert(renderRadius(n, w.environment) >= oldRadius);
  w.setEnvironment("seaLevel", 75);
  assert.equal(
    habitat(n, w.environment).water,
    habitat(n, { ...w.environment, seaLevel: 75 }).height < 0.75,
  );
  const barren = new PlanetWorld(42, undefined, 1, { fertility: 0 });
  barren.organisms = [];
  barren.food = [];
  for (let i = 0; i < 90; i++) barren.stepTick();
  assert.equal(barren.food.length, 0);
  const highSea = new PlanetWorld(42, undefined, 1, { seaLevel: 65 });
  assert(
    highSea.organisms.every((o) => !habitat(o.n, highSea.environment).water),
  );
});
test("spherical movement stays on the surface and crosses geographic seams", () => {
  let n = norm([1, 0.01, 0]),
    [heading] = basis(n);
  for (let i = 0; i < 10000; i++) {
    n = walk(n, heading, 1);
    heading = norm(heading.map((v, j) => v - n[j] * dot(n, heading)));
  }
  assert(Math.abs(Math.hypot(...n) - 1) < 1e-10);
  assert(distance([1, 0, 0], norm([1, 0, 0.001])) < 1);
});
test("planet neural shape includes mate and atmosphere channels", () => {
  const n = { count: 1, depth: 1, width: 6 };
  assert.deepEqual(architecture(n), [14, 6, 4]);
  assert.equal(parameterCount(n), 118);
  const w = new PlanetWorld(42, n);
  w.stepTick();
  for (const o of w.organisms) {
    assert.equal(o.traces[0][0].length, 14);
    assert.equal(o.control.length, 4);
    assert(o.control.every(Number.isFinite));
  }
});
test("tick partitioning and camera-independent model reproduce the same world", () => {
  const a = new PlanetWorld(42),
    b = new PlanetWorld(42);
  for (let i = 0; i < 60; i++) a.step(DT);
  for (let i = 0; i < 120; i++) b.step(DT / 2);
  assert.deepEqual(a.organisms, b.organisms);
  assert.deepEqual(a.food, b.food);
  assert.equal(a.tick, b.tick);
  balance(a);
});
test("single ancestor produces descendants and novel variants", () => {
  const w = new PlanetWorld(90210, undefined, 1);
  for (let i = 0; i < 5400; i++) w.stepTick();
  assert(w.births > 0);
  assert.equal(
    [...w.pedigree.values()].filter((o) => !o.parents.length).length,
    1,
  );
  assert(w.organisms.some((o) => o.role === "prey" && o.generation > 1));
  assert(w.newVariants > 0);
  assert(
    w.organisms.every(
      (o) =>
        Math.abs(Math.hypot(...o.n) - 1) < 1e-10 &&
        o.energy >= 0 &&
        o.health > 0,
    ),
  );
  balance(w);
});

test("ancestral copies have identical homozygous DNA and brains without shared storage", () => {
  const w = new PlanetWorld(42, { count: 2, depth: 1, width: 6 }, 4);
  const a = w.organisms[0];
  for (const b of w.organisms.slice(1)) {
    assert.deepEqual(a.dna, b.dna);
    assert.notEqual(a.dna, b.dna);
    assert.deepEqual(a.brains, b.brains);
    assert.notEqual(a.brains, b.brains);
    assert.equal(b.role, "prey");
    assert.notEqual(b.familyId, a.familyId);
  }
  assert(Object.values(a.dna).every(([x, y]) => x === y));
  assert.equal(w.variants.size, 1);
  assert.equal(new PlanetWorld().organisms.length, 2);
});
test("one parent funds budding; zero mutation preserves its genome and brain", () => {
  const w = new PlanetWorld(42, { count: 1, depth: 1, width: 6 }, 1),
    a = w.organisms[0];
  a.energy = 150;
  a.control[3] = 1;
  w.mutation = 0;
  w.ledger = { initial: w.storedEnergy(), input: 0, heat: 0 };
  w.mate();
  assert.equal(w.eggs.length, 1);
  assert.equal(a.energy, 60);
  assert.deepEqual(w.eggs[0].parents, [a.id]);
  balance(w);
  w.tick = 180;
  w.hatch();
  const b = w.organisms.at(-1);
  assert.deepEqual(a.dna, b.dna);
  assert.deepEqual(a.brains, b.brains);
  assert.notEqual(a.dna, b.dna);
  assert.notEqual(a.brains, b.brains);
  assert.equal(w.newVariants, 0);
  assert(a.offspring.includes(b.id));
  balance(w);
});
test("successive inherited diet mutations can produce a hunter from the ancestor", () => {
  const w = new PlanetWorld();
  const initial = structuredClone(w.organisms[0].dna);
  let dna = initial;
  for (let i = 0; i < 3; i++) dna = budDNA(dna, () => 0.99, 100).dna;
  assert.equal(feedingRole(initial), "prey");
  assert.equal(feedingRole(dna), "predator");
  const parent = w.organisms[0];
  parent.dna = dna;
  parent.traits = express(dna);
  parent.energy = 170;
  parent.control[3] = 1;
  w.mutation = 0;
  w.mate();
  w.tick = 180;
  w.hatch();
  assert.equal(w.organisms.at(-1).role, "predator");
  assert.deepEqual(w.organisms.at(-1).parents, [parent.id]);
});
