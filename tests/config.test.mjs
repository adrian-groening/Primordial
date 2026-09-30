import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Ecosystem } from "../dist/engine.js";
import {
  validateExperimentConfig,
  validateNeuralConfig,
} from "../dist/sim/config.js";
import {
  architecture,
  parameterCount,
  createBrains,
  evaluate,
  decide,
  INPUTS,
  OUTPUTS,
} from "../dist/neural.js";
const preset = JSON.parse(
  readFileSync(new URL("../dist/presets/legacy-v1.json", import.meta.url)),
);

test("uint32 seed bounds accepted; invalid seeds rejected", () => {
  for (const seed of [0, 0xffffffff])
    assert.equal(new Ecosystem(seed).initialSeed, seed);
  for (const seed of [
    -1,
    0x100000000,
    0.5,
    NaN,
    Infinity,
    -Infinity,
    "42",
    null,
  ])
    assert.throws(() => new Ecosystem(seed));
});
test("neural dimensions must be finite integers in supported ranges", () => {
  for (const [field, values] of Object.entries({
    count: [-1, 5, 1.5, NaN, Infinity, "1"],
    depth: [0, 4, 1.5, NaN, Infinity],
    width: [1, 13, 4.5, NaN, Infinity],
  })) {
    for (const value of values) {
      const config = { count: 1, depth: 1, width: 6, [field]: value };
      assert.throws(() => new Ecosystem(42, config));
      assert.throws(() => architecture(config));
    }
  }
  for (const config of [
    null,
    [],
    {},
    { count: 0, depth: 1, width: 6, unknown: 1 },
  ])
    assert.throws(() => validateNeuralConfig(config));
  assert.equal(parameterCount({ count: 1, depth: 1, width: 6 }), 62);
  assert.equal(parameterCount({ count: 4, depth: 3, width: 12 }), 1736);
  assert.equal(parameterCount({ count: 0, depth: 1, width: 6 }), 0);
});
test("validated architecture is copied and immutable", () => {
  const config = { count: 1, depth: 1, width: 6 },
    sim = new Ecosystem(42, config);
  config.width = 12;
  assert.equal(sim.neural.width, 6);
  assert.throws(() => {
    sim.neural.width = 12;
  });
});
test("preset rejects unknown modes, versions, fields and unsupported world/count settings", () => {
  const invalid = [
    { ...preset, mode: "predator" },
    { ...preset, mode: "neural" },
    { ...preset, schemaVersion: 2 },
    { ...preset, modelVersion: "v2" },
    { ...preset, extra: true },
    { ...preset, world: { width: 999, height: 700 } },
    { ...preset, world: { width: 1000.5, height: 700 } },
    { ...preset, world: { width: NaN, height: 700 } },
    { ...preset, initial: { organisms: 1, food: 230 } },
    { ...preset, initial: { organisms: 64, food: Infinity } },
    { ...preset, renewal: -1 },
    { ...preset, mutation: 101 },
    { ...preset, seed: "42" },
  ];
  for (const config of invalid)
    assert.throws(() => Ecosystem.fromConfig(config));
  const missing = { ...preset };
  delete missing.seed;
  assert.throws(() => validateExperimentConfig(missing));
  const result = validateExperimentConfig(preset);
  assert.notEqual(result.world, preset.world);
  const neural = Ecosystem.fromConfig({
    ...preset,
    mode: "neural",
    neural: { count: 1, depth: 1, width: 6 },
    renewal: 0,
    mutation: 100,
  });
  assert.equal(neural.organisms[0].brains.length, 1);
  assert.equal(neural.renewal, 0);
  assert.equal(neural.mutation, 100);
});
test("live rate validation is atomic and finite", () => {
  const sim = new Ecosystem();
  for (const [key, max] of [
    ["renewal", 100],
    ["mutation", 100],
  ]) {
    const before = sim[key];
    for (const value of [-1, max + 1, NaN, Infinity, "12", null]) {
      assert.throws(() => {
        sim[key] = value;
      });
      assert.equal(sim[key], before);
    }
    sim[key] = 0;
    assert.equal(sim[key], 0);
    sim[key] = max;
    assert.equal(sim[key], max);
  }
});
test("invalid dt cannot mutate model state", () => {
  const sim = new Ecosystem(),
    before = JSON.stringify(sim);
  for (const dt of [0, -1, NaN, Infinity, 1.1, "0.1", null]) {
    assert.throws(() => sim.step(dt));
    assert.equal(JSON.stringify(sim), before);
  }
  sim.step(1 / 60);
  assert.equal(sim.time, 1 / 60);
});
test("sensor and output schema rejects malformed inputs and weights", () => {
  assert.equal(INPUTS.length, 7);
  assert.equal(OUTPUTS.length, 2);
  const network = [Array.from({ length: 2 }, () => Array(8).fill(0))];
  for (const input of [
    [],
    Array(6).fill(0),
    Array(8).fill(0),
    Array(7),
    [NaN, 0, 0, 0, 0, 0, 0],
  ])
    assert.throws(() => evaluate(network, input));
  for (const bad of [
    [],
    null,
    [[Array(7).fill(0), Array(8).fill(0)]],
    [[Array(8).fill(Infinity), Array(8).fill(0)]],
    [[Array(8).fill(0)]],
    Array(2),
  ])
    assert.throws(() => evaluate(bad, Array(7).fill(0)));
  assert.deepEqual(decide([], Array(7).fill(0)), {
    traces: [],
    output: [0, 0],
  });
  assert.throws(() => decide(Array(1), Array(7).fill(0)));
});
test("incompatible parent topology and mutation fail before random consumption", () => {
  const config = { count: 1, depth: 1, width: 6 };
  let calls = 0;
  const random = () => {
    calls++;
    return 0.5;
  };
  for (const parent of [[], [[]], Array(1)])
    assert.throws(() => createBrains(config, random, parent));
  for (const mutation of [-1, 101, Infinity])
    assert.throws(() => createBrains(config, random, undefined, mutation));
  assert.equal(calls, 0);
});
