import { decide } from "../dist/sim/predator-neural.js";
import { decide as decideEvolving } from "../dist/sim/evolving-neural.js";

export function worldMetrics(world) {
  let prey = 0, predators = 0, generation = 0, updates = 0, reward = 0, autonomy = 0, plasticity = 0, loss = 0;
  for (const o of world.organisms) {
    if (o.role === "prey") prey++; else predators++;
    generation = Math.max(generation, o.generation);
    if (o.mind) {
      updates += o.mind.updates; reward += o.mind.reward; autonomy += o.mind.autonomy;
      plasticity += o.genes.plasticity; loss += o.mind.loss;
    }
  }
  return {
    tick: world.tick, time: world.time, population: world.organisms.length,
    prey, predators, generation, food: world.food.length, carcasses: world.carcasses.length,
    births: world.births, deaths: { ...world.deaths }, kills: world.kills,
    energyResidual: world.energyResidual(), technicalLimit: world.limitDiagnostic,
    intelligence: world.intelligence ? { updates, totalUpdates: world.learningUpdates, meanReward: reward / Math.max(1, world.organisms.length),
      meanAutonomy: autonomy / Math.max(1, world.organisms.length), meanLoss: loss / Math.max(1, world.organisms.length),
      meanPlasticity: plasticity / Math.max(1, world.organisms.length), ...world.abilityStats } : null,
  };
}
const previewSamples = new WeakMap();
function sample(items, limit, cache, key) {
  if (!limit) return [];
  if (items.length <= limit) {
    cache[key] = new Set(items.map((item) => item.id));
    return items;
  }
  const retained = items.filter((item) => cache[key]?.has(item.id));
  const needed = limit - retained.length;
  if (needed > 0) {
    const available = items.filter((item) => !cache[key]?.has(item.id));
    for (let i = 0; i < needed; i++) retained.push(available[Math.floor(i * available.length / needed)]);
  }
  cache[key] = new Set(retained.map((item) => item.id));
  return retained;
}
export function controlSnapshot(world, runtime, options = {}) {
  const metrics = worldMetrics(world);
  const selected = world.organisms.find((o) => o.id === options.selectedId);
  const visible = options.view !== false;
  let cache = previewSamples.get(world);
  if (!cache) { cache = {}; previewSamples.set(world, cache); }
  const organisms = sample(world.organisms, visible ? 1200 : 0, cache, "organisms").map((o) => ({
    id: o.id, role: o.role, x: o.x, y: o.y, angle: o.angle, size: o.size,
    speed: o.speed, health: o.health, maxHealth: o.maxHealth, sense: o.sense,
    hue: o.hue, pattern: o.pattern, generation: o.generation,
    activeAbilities: o.abilities ? { dash: o.abilities.dashUntil >= world.tick,
      shield: o.abilities.shieldUntil >= world.tick, camouflage: o.abilities.concealUntil >= world.tick,
      signal: o.abilities.signal?.until >= world.tick ? o.abilities.signal.value : 0 } : undefined,
  }));
  if (visible && selected && !organisms.some((o) => o.id === selected.id)) {
    if (organisms.length >= 1200) organisms.pop();
    const { id, role, x, y, angle, size, speed, health, maxHealth, sense, hue, pattern, generation } = selected;
    organisms.push({ id, role, x, y, angle, size, speed, health, maxHealth, sense, hue, pattern, generation,
      activeAbilities: selected.abilities ? { dash: selected.abilities.dashUntil >= world.tick,
        shield: selected.abilities.shieldUntil >= world.tick, camouflage: selected.abilities.concealUntil >= world.tick,
        signal: selected.abilities.signal?.until >= world.tick ? selected.abilities.signal.value : 0 } : undefined });
  }
  let inspection = null;
  if (selected) {
    const { brainArchive, genome, ...details } = selected;
    inspection = { ...details, mind: selected.mind ? { ...selected.mind, transition: undefined } : undefined,
      traces: selected.brains.length && selected.lastInputs
      ? (world.intelligence ? decideEvolving : decide)(selected.brains, selected.lastInputs).traces : [] };
  }
  return {
    modelVersion: world.modelVersion, tick: world.tick, time: world.time,
    width: world.width, height: world.height, boundary: world.boundary,
    fovDegrees: world.fovDegrees, initialPrey: world.initialPrey,
    initialPredators: world.initialPredators, initialFood: world.initialFood,
    budgets: world.budgets, neural: world.neural, renewal: world.renewal, mutation: world.mutation,
    organisms, food: sample(world.food, visible ? 2500 : 0, cache, "food").map(({ id, x, y, energy }) => ({ id, x, y, energy })),
    carcasses: sample(world.carcasses, visible ? 1200 : 0, cache, "carcasses").map(({ id, x, y, energy }) => ({ id, x, y, energy })),
    obstacles: visible ? world.obstacles : [], events: visible ? world.events : [],
    roleHistory: world.roleHistory, recentDeaths: world.recentDeaths,
    kills: world.kills, cannibalKills: world.cannibalKills, births: world.births,
    deaths: world.deaths, lastImpact: world.lastImpact, limitDiagnostic: world.limitDiagnostic,
    limitReached: world.limitReached, selected: inspection, metrics,
    intelligence: world.intelligence ?? null, abilityStats: world.abilityStats ?? null,
    runtime: { ...runtime, heapUsedBytes: process.memoryUsage().heapUsed },
    viewSampled: visible && organisms.length < world.organisms.length,
  };
}
