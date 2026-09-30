import test from "node:test";
import assert from "node:assert/strict";
import { PredatorWorld, makeRenderSnapshot } from "../dist/sim/predator-world.js";
import { appearanceFor } from "../dist/render/phenotype2d.js";
import { drawStream } from "../dist/sim/random.js";

test("color and markings are inherited without changing ecological random streams", () => {
  const world = new PredatorWorld(47, undefined, 0, { prey: 1, food: 0 });
  const parent = world.organisms[0];
  world.mutation = 0;
  const expected = { mutationSeed: world.mutationSeed };
  for (let i = 0; i < 3; i++) drawStream(expected, "mutationSeed");
  const environmentBefore = world.environmentSeed;
  const child = world.create("prey", parent);
  assert.equal(child.hue, parent.hue);
  assert.equal(child.pattern, parent.pattern);
  assert.equal(world.mutationSeed, expected.mutationSeed);
  assert.equal(world.environmentSeed, environmentBefore);

  world.mutation = 60;
  const descendants = Array.from({ length: 30 }, () => world.create("prey", parent));
  assert(descendants.some((o) => o.hue !== parent.hue));
  assert(descendants.some((o) => o.pattern !== parent.pattern));
  assert(descendants.every((o) => o.hue >= 92 && o.hue <= 166 &&
    o.pattern >= 0 && o.pattern <= 1));
  const state = world.exportState();
  const restored = PredatorWorld.restore(state);
  assert.equal(restored.organisms[0].hue, parent.hue);
  assert.equal(restored.organisms[0].pattern, parent.pattern);
});

test("render traits visibly follow inherited size, speed, sensing, and markings", () => {
  const world = new PredatorWorld(48, undefined, 1, { prey: 1, food: 0 });
  const prey = world.organisms.find((o) => o.role === "prey");
  const slow = appearanceFor({ ...prey, size: 3, speed: 18, sense: 60, pattern: 0 });
  const fast = appearanceFor({ ...prey, size: 7, speed: 48, sense: 200, pattern: 1 });
  assert(fast.bodyLength > slow.bodyLength);
  assert(fast.tailLength > slow.tailLength);
  assert(fast.feelerLength > slow.feelerLength);
  assert(fast.markingCount > slow.markingCount);
  assert.equal(appearanceFor(prey).hue, prey.hue);
  const snapshot = makeRenderSnapshot(world);
  assert.equal(snapshot.organisms[0].pattern, prey.pattern);
  assert.equal(snapshot.organisms[0].speed, prey.speed);
});
