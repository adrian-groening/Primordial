import test from "node:test";
import assert from "node:assert/strict";
import { PredatorWorld } from "../dist/sim/predator-world.js";
import { beginFoodComparison, advanceFoodComparison, foodComparisonResult } from "../dist/sim/decision-lab.js";

test("food comparison forks the same state and yields an actionable difference", () => {
  const world = new PredatorWorld(91, undefined, 0, { prey: 0, food: 0 });
  world.renewal = 0;
  const before = world.stateKey();
  const comparison = beginFoodComparison(world, 300);
  assert.equal(comparison.original, 0);
  assert.equal(comparison.proposed, 20);
  while (!advanceFoodComparison(comparison, 20)) {}
  const result = foodComparisonResult(comparison);
  assert.equal(result.current.food, 0);
  assert(result.trial.food > 0);
  assert.match(result.message, /Keep the current level/i);
  assert.equal(world.stateKey(), before);
});
