import test from "node:test";
import assert from "node:assert/strict";
import { Ecosystem } from "../dist/engine.js";
import { parameterCount } from "../dist/neural.js";

function emptyFood(sim) {
  sim.food = [];
  sim.renewal = 0;
  return sim;
}
function finiteWorld(sim) {
  assert(Number.isFinite(sim.time));
  for (const o of sim.organisms) {
    for (const key of [
      "x",
      "y",
      "angle",
      "energy",
      "age",
      "speed",
      "sense",
      "size",
    ])
      assert(Number.isFinite(o[key]), key);
    assert(o.x >= 0 && o.x <= 1000 && o.y >= 0 && o.y <= 700);
  }
}
test("empty extinct world remains empty without reseeding", () => {
  const sim = emptyFood(new Ecosystem());
  sim.organisms = [];
  for (let i = 0; i < 300; i++) sim.step(1 / 30);
  assert.equal(sim.organisms.length, 0);
  assert.equal(sim.food.length, 0);
  assert.equal(sim.births, 0);
  finiteWorld(sim);
});
test("zero renewal does not generate food and unfed founders go extinct", () => {
  const sim = emptyFood(new Ecosystem());
  assert.equal(sim.organisms.length, 64);
  for (let i = 0; i < 5400; i++) sim.step(1 / 30);
  assert.equal(sim.food.length, 0);
  assert.equal(sim.organisms.length, 0);
  assert.equal(sim.births, 0);
});
test("all world corners and boundaries remain finite for both controllers", () => {
  for (const count of [0, 1])
    for (const [x, y] of [
      [0, 0],
      [1000, 0],
      [0, 700],
      [1000, 700],
      [0, 350],
      [1000, 350],
      [500, 0],
      [500, 700],
    ]) {
      const sim = emptyFood(new Ecosystem(42, { count, depth: 1, width: 6 }));
      sim.organisms = sim.organisms.slice(0, 1);
      Object.assign(sim.organisms[0], { x, y });
      for (let i = 0; i < 60; i++) sim.step(1 / 30);
      assert.equal(sim.organisms.length, 1);
      finiteWorld(sim);
    }
});
test("neural sensors at a corner encode food absence, walls and internal state", () => {
  const sim = emptyFood(new Ecosystem(42, { count: 1, depth: 1, width: 6 }));
  sim.organisms = sim.organisms.slice(0, 1);
  const o = sim.organisms[0];
  Object.assign(o, { x: 0, y: 0, angle: 0, energy: 85 });
  sim.step(1 / 30);
  const input = o.traces[0][0];
  assert.deepEqual(input.slice(0, 6), [0, 0, 0, 0, 1, 1]);
  assert.equal(input[6], Math.sin(2 / 30));
  assert.equal(o.traces[0].at(-1).length, 2);
});
test("zero mutation copies traits/weights; full mutation never aliases or exceeds bounds", () => {
  for (const mutation of [0, 100]) {
    const sim = new Ecosystem(42, { count: 4, depth: 3, width: 12 });
    sim.mutation = mutation;
    const p = sim.organisms[0],
      before = JSON.stringify(p),
      child = sim.create(p);
    assert.equal(JSON.stringify(p), before);
    assert.notEqual(child.brains, p.brains);
    assert.equal(child.generation, 2);
    for (const [key, min, max] of [
      ["speed", 12, 60],
      ["sense", 35, 170],
      ["size", 3, 9],
      ["hue", 75, 180],
    ]) {
      assert(child[key] >= min && child[key] <= max);
      if (!mutation) assert.equal(child[key], p[key]);
    }
    if (!mutation) assert.deepEqual(child.brains, p.brains);
    else assert.notDeepEqual(child.brains, p.brains);
    const weights = child.brains.flat(3);
    assert.equal(weights.length, parameterCount(sim.neural));
    assert(weights.every((v) => Number.isFinite(v) && v >= -4 && v <= 4));
  }
});
test("legacy hard food cap remains characterized", () => {
  const sim = new Ecosystem();
  while (sim.food.length < 650) sim.addFood();
  const before = sim.seed;
  sim.addFood();
  assert.equal(sim.food.length, 650);
  assert.equal(sim.seed, before);
});
test("legacy age-limit reproduction ordering is characterized, not corrected in P00", () => {
  const sim = emptyFood(new Ecosystem());
  const o = sim.organisms[0];
  sim.organisms = [o];
  o.age = 160;
  o.energy = 150;
  sim.step(1 / 30);
  assert.equal(sim.births, 1);
  assert.equal(sim.organisms.length, 1);
  assert.equal(sim.organisms[0].generation, 2);
  assert.equal(sim.organisms[0].age, 0);
});
