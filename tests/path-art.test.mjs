import test from "node:test";
import assert from "node:assert/strict";
import { TrajectoryRecorder } from "../dist/art/trajectory-recorder.js";
import { exportPathSVG } from "../dist/art/path-art.js";
import { EvolvingWorld } from "../dist/sim/evolving-world.js";

test("art paths come from engine coordinates, stay bounded and preserve dead-organism traces", () => {
  const recorder = new TrajectoryRecorder({ limit: 1, capacity: 2 });
  const world = { tick: 6, width: 500, height: 500, organisms: [
    { id: 1, x: 10, y: 20, hue: 120, role: "prey", generation: 1 }] };
  recorder.capture(world);
  for (const x of [20, 30, 40]) { world.tick += 6; world.organisms[0].x = x; recorder.capture(world); }
  assert.equal(recorder.segments().length, 2);
  assert.deepEqual(recorder.segments().map((s) => [s.x1, s.x2]), [[20, 30], [30, 40]]);
  world.organisms = []; world.tick += 6; recorder.capture(world);
  assert.equal(recorder.segments().length, 2);
  const art = recorder.snapshot("test");
  assert.equal(art.totalRecorded, 3);
  assert.match(exportPathSVG(art), /M20.00,20.00L30.00,20.00/);
  assert.throws(() => exportPathSVG(art, "invalid"));
});
test("periodic seam crossing does not draw an invented line across the world", () => {
  const recorder = new TrajectoryRecorder();
  const world = { tick: 6, width: 500, height: 500, boundary: "periodic",
    organisms: [{ id: 1, x: 499, y: 200, hue: 120, role: "prey", generation: 1 }] };
  recorder.capture(world); world.tick = 12; world.organisms[0].x = 1; recorder.capture(world);
  assert.equal(recorder.segments().length, 0);
  world.tick = 18; world.organisms[0].x = 4; recorder.capture(world);
  assert.equal(recorder.segments()[0].x1, 1);
});
test("recording and exporting art do not change learning, physics or RNG; saved paths restore", () => {
  const w = new EvolvingWorld(31, undefined, 0, { prey: 3 });
  const recorder = new TrajectoryRecorder(); recorder.reset(w);
  for (let i = 0; i < 60; i++) { w.stepTick(); recorder.capture(w); }
  const before = w.stateKey(), art = recorder.snapshot("test");
  assert(art.segments.length > 0);
  assert.match(exportPathSVG(art), /Actual recorded movement/);
  const restored = TrajectoryRecorder.restore(recorder.exportState());
  assert.deepEqual(restored.segments(), recorder.segments());
  assert.equal(w.stateKey(), before);
  const delta = recorder.snapshot("test", art.sequence, art.streamId);
  assert.equal(delta.segments.length, 0);
});
