import test from "node:test";
import assert from "node:assert/strict";
import { PredatorWorld } from "../dist/sim/predator-world.js";
import { bodyRadius, firstBodyHit, hasBodySpace } from "../dist/sim/body-space.js";
import { displacement } from "../dist/sim/spatial-grid.js";

function separated(world) {
  const live = world.organisms.filter((o) => !o.dead);
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j];
    const distance = Math.sqrt(displacement(a, b, world.width, world.height,
      world.boundary === "periodic").squared);
    assert(distance + 1e-6 >= bodyRadius(a) + bodyRadius(b),
      `overlap at tick ${world.tick}: ${a.id} and ${b.id}`);
  }
}

test("founders and living descendants retain separate occupied space", () => {
  for (const boundary of ["reflect", "periodic"]) {
    const world = new PredatorWorld(90210, undefined, 8,
      { prey: 80, food: 60, boundary });
    separated(world);
    for (let tick = 0; tick < 900; tick++) {
      world.stepTick();
      if (tick % 30 === 0) separated(world);
    }
    separated(world);
    assert(world.births > 0);
    assert(Math.abs(world.energyResidual()) < 1e-6);
  }
});

test("swept body contact blocks crossing and sees periodic seam blockers", () => {
  const mover = { id: 1, role: "prey", size: 4, x: 20, y: 100 };
  const blocker = { id: 2, role: "prey", size: 4, x: 100, y: 100 };
  const hit = firstBodyHit(mover, { x: 180, y: 100 }, mover,
    [mover, blocker], 250, 250, false);
  assert(hit && hit.fraction > 0 && hit.fraction < 1);
  assert.equal(hit.blockerId, 2);
  assert.equal(hasBodySpace({ x: 247, y: 100 }, bodyRadius(mover),
    [{ ...blocker, x: 3 }], [], 250, 250, true), false);
  assert(firstBodyHit({ ...mover, x: 245 }, { x: 255, y: 100 }, mover,
    [mover, { ...blocker, x: 3 }], 250, 250, true));
});

test("movement collision results do not depend on organism storage order", () => {
  const original = new PredatorWorld(62, undefined, 0, { prey: 2, food: 0 });
  original.renewal = 0;
  original.tick = 1;
  original.time = 1 / 30;
  const [a, b] = original.organisms;
  Object.assign(a, { x: 400, y: 350, angle: 0, speed: 48, vx: 0, vy: 0,
    control: [0, 1, -1, 0, 0] });
  Object.assign(b, { x: 400 + bodyRadius(a) + bodyRadius(b) + 0.2,
    y: 350, angle: Math.PI, speed: 48, vx: 0, vy: 0,
    control: [0, 1, -1, 0, 0] });
  const reversed = PredatorWorld.restore(original.exportState());
  reversed.organisms.reverse();
  original.stepTick();
  reversed.stepTick();
  const positions = (world) => world.organisms.map((o) => [o.id, o.x, o.y, o.vx, o.vy])
    .sort((x, y) => x[0] - y[0]);
  assert.deepEqual(positions(original), positions(reversed));
  separated(original);
  separated(reversed);
});

test("crowded births wait without charging energy or creating an overlap", () => {
  const world = new PredatorWorld(7, undefined, 0,
    { width: 250, height: 250, prey: 1, food: 0 });
  const o = world.organisms[0];
  o.x = 125; o.y = 125; o.energy = 150; o.age = 11;
  world.obstacles = [36, 78, 120].flatMap((distance) =>
    Array.from({ length: 24 }, (_, i) => ({
      x: 125 + distance * Math.cos(i * Math.PI / 12),
      y: 125 + distance * Math.sin(i * Math.PI / 12),
      radius: distance === 36 ? 20 : 25,
    })));
  const before = o.energy;
  world.reproduce();
  assert.equal(world.births, 0);
  assert.equal(world.crowdedBirths, 1);
  assert.equal(o.energy, before);
  separated(world);
});
