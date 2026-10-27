import test from "node:test";
import assert from "node:assert/strict";
import { SnapshotMotion } from "../dist/render/snapshot-motion.js";
import { Camera2D } from "../dist/render/camera2d.js";
import { PredatorWorld } from "../dist/sim/predator-world.js";
import { controlSnapshot } from "../scripts/simulation-snapshot.mjs";

function snapshot(tick, x, extra = {}) {
  return { tick, time: tick / 30, width: 1000, height: 1000, boundary: "reflect",
    organisms: [{ id: 1, x, y: 500, angle: 0 }], runtime: { runId: "test", paused: false }, ...extra };
}
test("motion changes between network updates without altering observations or extrapolating", () => {
  const motion = new SnapshotMotion({ delay: 100, adaptive: false });
  const a = snapshot(0, 100), b = snapshot(6, 160);
  const original = JSON.stringify([a, b]);
  motion.push(a, 1000); motion.push(b, 1200);
  assert.equal(motion.frame(1100).organisms[0].x, 100);
  assert.equal(motion.frame(1200).organisms[0].x, 130);
  assert.equal(motion.frame(1250).organisms[0].x, 145);
  assert.equal(motion.frame(1500).organisms[0].x, 160);
  assert.equal(motion.frame(1200).time, 0.1);
  assert.equal(JSON.stringify([a, b]), original);
});
test("periodic positions and headings interpolate across their seams", () => {
  const motion = new SnapshotMotion({ delay: 100, adaptive: false });
  const a = snapshot(1, 990, { boundary: "periodic" });
  const b = snapshot(7, 10, { boundary: "periodic" });
  a.organisms[0].angle = Math.PI - 0.1;
  b.organisms[0].angle = -Math.PI + 0.1;
  motion.push(a, 1000); motion.push(b, 1200);
  const o = motion.frame(1200).organisms[0];
  assert.equal(o.x, 0);
  assert(Math.abs(o.angle - Math.PI) < 1e-9);
});
test("pause, restoration, resize and re-enabling visualization reset stale motion", () => {
  const cases = [
    snapshot(7, 500, { runtime: { runId: "test", paused: true } }),
    snapshot(0, 500), snapshot(7, 500, { width: 2000 }),
    snapshot(7, 500, { runtime: { runId: "new", paused: false } }),
  ];
  for (const next of cases) {
    const motion = new SnapshotMotion({ delay: 100, adaptive: false });
    motion.push(snapshot(6, 100), 1000); motion.push(next, 1100);
    assert.equal(motion.frame(1100).organisms[0].x, 500);
  }
  const motion = new SnapshotMotion();
  motion.push(snapshot(6, 100), 1000);
  motion.push(snapshot(7, 100, { organisms: [] }), 1100);
  motion.push(snapshot(8, 500), 1200);
  assert.equal(motion.frame(1200).organisms[0].x, 500);
});
test("close-up camera makes the same movement visible in a large world", () => {
  const camera = new Camera2D(), o = { x: 6000, y: 6000 };
  const overview = camera.transform(1000, 1000, 12000, 12000);
  camera.inspect(o, 1000, 1000, 12000, 12000);
  const close = camera.transform(1000, 1000, 12000, 12000);
  assert.equal(close.scale, 1);
  assert(close.scale / overview.scale >= 12);
  assert.deepEqual(camera.screenToWorld(500, 500, 1000, 1000, 12000, 12000), o);
  camera.fit();
  assert.equal(camera.zoom, 1);
});
test("preview identities remain stable when the population changes", () => {
  const world = new PredatorWorld(42, undefined, 0, { width: 12000, height: 12000, prey: 2000,
    food: 0, budgets: { organisms: 5000 } });
  const a = controlSnapshot(world, {});
  const removedId = a.organisms[0].id;
  world.organisms = world.organisms.filter((o) => o.id !== removedId);
  const b = controlSnapshot(world, {}), ids = new Set(b.organisms.map((o) => o.id));
  assert.equal(b.organisms.length, 1200);
  assert.equal(a.organisms.filter((o) => ids.has(o.id)).length, 1199);
  assert(!ids.has(removedId));
});
