import test from "node:test";
import assert from "node:assert/strict";
import { PredatorWorld, makeRenderSnapshot } from "../dist/sim/predator-world.js";
import { decide } from "../dist/sim/predator-neural.js";
import { SpatialGrid, displacement } from "../dist/sim/spatial-grid.js";
import { TickClock } from "../dist/sim/tick-clock.js";
import { Camera2D } from "../dist/render/camera2d.js";
import { segmentCircleHit } from "../dist/sim/obstacles2d.js";

test("18,000 ticks with a living founder, commands and pause are frame-rate independent", () => {
  const keys = [];
  for (const hz of [30, 60, 144]) {
    const world = new PredatorWorld(7, undefined, 0, { prey: 1, food: 0 });
    world.renewal = 0;
    world.schedule({ type: "renewal", value: 10, tick: 100 });
    world.schedule({ type: "mutation", value: 25, tick: 100 });
    world.schedule({ type: "renewal", value: 0, tick: 101 });
    const clock = new TickClock();
    for (let frame = 0; frame < hz * 600; frame++) {
      if (frame === hz * 200) continue; // a paused frame requests no model time
      const ticks = clock.request(1 / hz);
      for (let i = 0; i < ticks; i++) world.stepTick();
    }
    // One omitted frame can change the final tick at 30 Hz; advance all to a common tick.
    while (world.tick < 18000) world.stepTick();
    assert.equal(world.tick, 18000);
    assert.deepEqual(world.commandLog.map((c) => [c.tick, c.type, c.value]), [
      [100, "renewal", 10], [100, "mutation", 25], [101, "renewal", 0],
    ]);
    keys.push(world.stateKey());
  }
  assert.equal(keys[0], keys[1]);
  assert.equal(keys[1], keys[2]);
  for (const speed of [1, 3, 8]) {
    const clock = new TickClock();
    let ticks = 0;
    for (let i = 0; i < 600; i++) ticks += clock.request(1 / 60, speed);
    assert.equal(ticks, 300 * speed);
  }
});

test("technical-limit rejection retains state and RNG; raised budget resumes reference", () => {
  const make = (budget) => {
    const w = new PredatorWorld(51, undefined, 0, {
      prey: 0, food: 0, budgets: { organisms: budget },
    });
    w.renewal = 0;
    w.schedule({ type: "introducePredators", value: 2, tick: 1 });
    return w;
  };
  const limited = make(1);
  const before = limited.exportState();
  assert.equal(limited.stepTick(), null);
  assert.deepEqual(limited.exportState(), before);
  assert.deepEqual(limited.limitDiagnostic, { tick: 1, store: "organisms", budget: 1 });
  limited.raiseBudget("organisms", 2);
  const reference = make(2);
  limited.stepTick();
  reference.stepTick();
  assert.equal(limited.stateKey(), reference.stateKey());
  assert(Math.abs(limited.energyResidual()) < 1e-8);
});

test("fast ticks match transactional ticks with neural control and changing resources", () => {
  const fast = new PredatorWorld(90210, { count: 1, depth: 2, width: 12 });
  const reference = PredatorWorld.restore(fast.exportState());
  for (let i = 0; i < 90; i++) {
    const staged = PredatorWorld.restore(reference.exportState());
    staged._stepTick();
    Object.assign(reference, staged);
    fast.stepTick();
    assert.equal(fast.stateKey(), reference.stateKey(), `tick ${i + 1}`);
  }
});

test("food and carcass budget rejections leave the tick untouched", () => {
  const food = new PredatorWorld(17, undefined, 0, {
    prey: 0, food: 1, budgets: { food: 1 },
  });
  food.renewal = 100;
  for (let i = 0; i < 20 && !food.limitDiagnostic; i++) {
    const before = food.exportState();
    food.stepTick();
    if (food.limitDiagnostic) {
      assert.deepEqual(food.exportState(), before);
      assert.equal(food.limitDiagnostic.store, "food");
    }
  }
  assert(food.limitDiagnostic);

  const carcass = new PredatorWorld(17, undefined, 0, {
    prey: 1, food: 0, budgets: { carcasses: 1 },
  });
  carcass.renewal = 0;
  carcass.organisms[0].energy = 0;
  carcass.carcasses.push({ id: 1000, sourceId: 999, role: "prey", x: 0, y: 0, energy: 1 });
  const before = carcass.exportState();
  assert.equal(carcass.stepTick(), null);
  assert.deepEqual(carcass.exportState(), before);
  assert.equal(carcass.limitDiagnostic.store, "carcasses");
});

test("spatial neighborhoods equal brute force, including periodic seams", () => {
  const width = 1000, height = 700;
  const items = Array.from({ length: 500 }, (_, id) => ({
    id, x: (id * 127.73) % width, y: (id * 89.31) % height,
  }));
  items.push({ id: 500, x: 999, y: 699 });
  for (const periodic of [false, true]) {
    const grid = new SpatialGrid(width, height, 64, periodic).load(items);
    for (const [x, y, radius] of [[0, 0, 15], [998, 698, 60], [412, 377, 170]]) {
      const point = { x, y };
      const exact = (list) => list.filter((item) => displacement(point, item, width, height, periodic).squared <= radius ** 2)
        .map((item) => item.id).sort((a, b) => a - b);
      assert.deepEqual(exact(grid.query(x, y, radius)), exact(items));
    }
  }
});

test("uniform camera maps display coordinates back to world coordinates", () => {
  const camera = new Camera2D();
  const t = camera.transform(900, 900, 1000, 700);
  assert.equal(t.scale, 900 / 700);
  assert(Math.abs(t.y) < 1e-9);
  assert(t.x <= 0 && t.x + 1000 * t.scale >= 900);
  assert.deepEqual(camera.screenToWorld(450, 450, 900, 900, 1000, 700), { x: 500, y: 350 });
  camera.zoomAt(2, 450, 450, 900, 900, 1000, 700);
  assert.deepEqual(camera.screenToWorld(450, 450, 900, 900, 1000, 700), { x: 500, y: 350 });
  camera.panX = camera.panY = 10000;
  const panned = camera.transform(900, 900, 1000, 700);
  assert.equal(panned.x, 0);
  assert.equal(panned.y, 0);
  camera.zoomAt(0.01, 450, 450, 900, 900, 1000, 700);
  assert.equal(camera.zoom, 1);
});

test("inspection and render snapshots leave a nonempty neural world unchanged", () => {
  const w = new PredatorWorld(71, { count: 1, depth: 1, width: 6 }, 1, { prey: 2, food: 3 });
  w.stepTick();
  const before = w.stateKey();
  const selected = w.organisms[0];
  const snapshot = makeRenderSnapshot(w, selected.id);
  assert.equal(snapshot.selectedId, selected.id);
  assert(!Object.hasOwn(snapshot.organisms[0], "brains"));
  assert.equal(decide(selected.brains, selected.lastInputs).traces.length, 1);
  snapshot.organisms[0].x = -100;
  assert.equal(w.stateKey(), before);
  const restored = PredatorWorld.restore(w.exportState());
  assert.equal(restored.stateKey(), before);
  assert(Object.isFrozen(restored.neural));
});

test("new 2D configuration rejects malformed bounds and unknown options", () => {
  for (const options of [
    { width: 249 }, { height: 4001 }, { width: 500.5 },
    { boundary: "teleport" }, { fovDegrees: 0 }, { prey: -1 },
    { budgets: { organisms: 0 } }, { budgets: { magic: 10 } },
    { nonexistent: true },
    { obstacles: [{ x: 10, y: 10, radius: 0 }] },
  ]) assert.throws(() => new PredatorWorld(1, undefined, 0, options));
});

test("swept motion and contact checks cannot tunnel through a thin obstacle", () => {
  assert(segmentCircleHit({ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 0, radius: 0.5 }) > 0);
  const w = new PredatorWorld(12, undefined, 1, {
    prey: 1, food: 0, obstacles: [{ x: 106, y: 100, radius: 0.5 }],
  });
  w.renewal = 0;
  const [prey, hunter] = w.organisms;
  prey.x = 112; prey.y = 100;
  hunter.x = 100; hunter.y = 100;
  hunter.control = [0, 1, 1, 1, 1];
  const health = prey.health;
  assert.equal(w.sense(hunter).food, null);
  w.resolveCombat();
  assert.equal(prey.health, health);
  const moving = new PredatorWorld(12, undefined, 0, {
    prey: 1, food: 0, obstacles: [{ x: 115, y: 100, radius: 0.5 }],
  });
  moving.renewal = 0;
  const actor = moving.organisms[0];
  actor.x = actor.y = 100;
  actor.vx = 500; actor.vy = 0;
  actor.speed = 500;
  actor.angle = 0;
  actor.control = [0, 1, 0, 1, 1];
  moving.tick = 1;
  moving.stepTick();
  assert(moving.organisms[0].x < 115 - 0.5 - actor.size + 1e-3);
});
