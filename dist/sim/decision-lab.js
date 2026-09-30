import { PredatorWorld } from "./predator-world.js";

const counts = (world) => ({
  prey: world.organisms.filter((o) => o.role === "prey").length,
  predators: world.organisms.filter((o) => o.role === "predator").length,
  food: world.food.length,
});

/** Two futures begin from exactly the same checkpoint and RNG states. */
export function beginFoodComparison(world, horizon = 300) {
  const state = world.exportState();
  const current = PredatorWorld.restore(state);
  const trial = PredatorWorld.restore(state);
  const proposed = world.renewal <= 75
    ? Math.min(100, world.renewal + 20)
    : Math.max(0, world.renewal - 20);
  trial.schedule({ type: "renewal", value: proposed, tick: trial.tick + 1 });
  return {
    current, trial, proposed, original: world.renewal,
    start: counts(world), startTick: world.tick,
    ticks: 0, horizon, done: false, censored: null,
  };
}

export function advanceFoodComparison(comparison, count = 1) {
  for (let i = 0; i < count && !comparison.done; i++) {
    if (!comparison.current.stepTick() || !comparison.trial.stepTick()) {
      comparison.censored = comparison.current.limitDiagnostic ?? comparison.trial.limitDiagnostic;
      comparison.done = true;
      break;
    }
    comparison.ticks++;
    if (comparison.ticks >= comparison.horizon) comparison.done = true;
  }
  return comparison.done;
}

export function foodComparisonResult(comparison) {
  if (!comparison.done || comparison.censored) return null;
  const current = counts(comparison.current);
  const trial = counts(comparison.trial);
  const preyDifference = trial.prey - current.prey;
  const message = preyDifference > 0
    ? `${preyDifference} more prey survived with the tested food level. Try it in the live run.`
    : preyDifference < 0
      ? `${-preyDifference} fewer prey survived with the tested food level. Keep the current level or test another change.`
      : `Prey survival stayed the same. Keep the current level for now and watch longer before changing it.`;
  return { current, trial, preyDifference, message };
}
