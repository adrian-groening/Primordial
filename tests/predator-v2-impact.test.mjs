import test from "node:test";
import assert from "node:assert/strict";
import { PredatorWorld } from "../dist/sim/predator-world.js";
import { drawUint32 } from "../dist/sim/random.js";

test("Skyfall is a logged, energy-balanced impact with visible aftermath", () => {
  const world = new PredatorWorld(81, undefined, 0, { prey: 2, food: 0 });
  world.renewal = 0;
  const first = drawUint32(world.environmentSeed);
  const second = drawUint32(first.state);
  const x = world.width * (0.2 + first.value * 0.6);
  const y = world.height * (0.2 + second.value * 0.6);
  world.organisms[0].x = x;
  world.organisms[0].y = y;
  world.organisms[1].x = x < world.width / 2 ? world.width - 20 : 20;
  world.organisms[1].y = y < world.height / 2 ? world.height - 20 : 20;
  world.schedule({ type: "impact", tick: 1 });
  world.stepTick();
  assert.equal(world.deaths.impact, 1);
  assert.equal(world.organisms.length, 1);
  assert.equal(world.carcasses.length, 1);
  assert.equal(world.lastImpact.casualties, 1);
  assert.equal(world.events.find((event) => event.kind === "impact")?.until, 46);
  assert.equal(world.commandLog[0].type, "impact");
  assert(Math.abs(world.energyResidual()) < 1e-7);
});
