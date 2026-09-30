import test from "node:test";
import assert from "node:assert/strict";
import { PlanetView } from "../dist/render/planet-view.js";
import { PlanetWorld } from "../dist/sim/planet-world.js";
function rendererFixture() {
  const listeners = {},
    canvas = {
      addEventListener: (name, fn) => (listeners[name] = fn),
      getBoundingClientRect: () => ({
        width: 1000,
        height: 700,
        left: 0,
        top: 0,
      }),
      setPointerCapture() {},
    };
  const renderer = {
    setPixelRatio() {},
    setSize() {},
    render(scene, camera) {
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
    },
  };
  let picked = null;
  const view = new PlanetView(
    canvas,
    (id) => {
      picked = id;
    },
    () => renderer,
  );
  return { view, listeners, picked: () => picked };
}
test("3D scene has finite terrain, articulated trait meshes, eggs and controls", () => {
  const { view, listeners } = rendererFixture(),
    world = new PlanetWorld(),
    o = world.organisms[0];
  view.render(world, o.id);
  assert.equal(view.models.size, 2);
  assert.equal(view.planet.material.color.getHex(), 0x000000);
  assert.equal(view.scene.background.getHex(), 0x000000);
  assert(view.grid.isLineSegments);
  assert(view.grid.geometry.attributes.position.count > 1000);
  assert(
    view.decor.children.every((g) => g.children.every((c) => c.isLineSegments)),
  );
  assert.equal(view.motionVector.visible, true);
  assert(view.motionVector.position.toArray().every(Number.isFinite));
  assert.equal(view.decor.children.length, 240);
  assert(view.planet.geometry.attributes.position.count > 6000);
  assert(
    Array.from(view.planet.geometry.attributes.position.array).every(
      Number.isFinite,
    ),
  );
  const model = view.models.get(o.id);
  assert(model.children.length > 12);
  assert.equal(model.userData.cilia.length, 8);
  assert.equal(model.userData.id, o.id);
  const original = view.yaw;
  listeners.pointerdown({ clientX: 0, clientY: 0, pointerId: 1 });
  listeners.pointermove({ clientX: 50, clientY: 5 });
  listeners.pointerup({ clientX: 50, clientY: 5 });
  assert.notEqual(view.yaw, original);
  const d = view.distance;
  listeners.wheel({ deltaY: -1, preventDefault() {} });
  assert(view.distance < d);
  view.focus(o);
  view.render(world, o.id);
  assert.equal(view.follow, o.id);
  assert.equal(view.distance, 55);
  assert(view.camera.position.toArray().every(Number.isFinite));
  view.overview();
  assert.equal(view.follow, null);
  assert.equal(view.distance, 290);
  world.setEnvironment("seaLevel", 70);
  view.render(world, o.id);
  assert.equal(view.version, world.environmentVersion);
  assert(view.decor.children.length < 240);
});
test("reset removes stale animal meshes, renderer does not mutate simulation", () => {
  const { view } = rendererFixture(),
    world = new PlanetWorld(),
    before = JSON.stringify(world.organisms),
    seed = world.seed;
  view.render(world, world.organisms[0].id);
  view.render(world, world.organisms[0].id);
  assert.equal(JSON.stringify(world.organisms), before);
  assert.equal(world.seed, seed);
  const next = new PlanetWorld(42, undefined, 3);
  view.render(next, next.organisms[0].id);
  assert.equal(view.models.size, 3);
  assert.equal(view.animals.children.length, 3);
});
