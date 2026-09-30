import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Ecosystem } from "../dist/engine.js";
import { legacyState } from "./fixtures/legacy-state.mjs";
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/legacy-v1.json", import.meta.url)),
);
const digest = (sim) =>
  createHash("sha256")
    .update(JSON.stringify(legacyState(sim)))
    .digest("hex");
for (const scenario of fixture.cases) {
  test(`legacy-v1 exact trajectory: ${JSON.stringify(scenario.neural)}`, () => {
    const sim = new Ecosystem(fixture.seed, scenario.neural);
    let step = 0;
    for (const sample of scenario.samples) {
      while (step < sample.step) {
        sim.step(fixture.dt);
        step++;
      }
      assert.equal(sim.organisms.length, sample.population);
      assert.equal(sim.food.length, sample.food);
      assert.equal(sim.births, sample.births);
      assert.equal(
        digest(sim),
        sample.stateSha256,
        `Legacy state changed at step ${step}. Fixture runtime: ${fixture.node}/${fixture.v8}/${fixture.platform}/${fixture.arch}; current: ${process.version}/${process.versions.v8}/${process.platform}/${process.arch}. Investigate numerical/runtime differences before deliberately updating a fixture.`,
      );
    }
  });
}
test("legacy preset constructs exactly the original default world", () => {
  const config = JSON.parse(
    readFileSync(new URL("../dist/presets/legacy-v1.json", import.meta.url)),
  );
  assert.deepEqual(
    legacyState(Ecosystem.fromConfig(config)),
    legacyState(new Ecosystem()),
  );
});
