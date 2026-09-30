import {
  DEFAULT_NEURAL,
  validateSeed,
  validateNeuralConfig,
  validateMutation,
  numberInRange,
} from "./config.js";
import {
  createBrains,
  decide,
  parameterCount,
  INPUTS,
  OUTPUTS,
  OBSERVATION_VERSION,
} from "./predator-neural.js";
import { SpatialGrid, displacement } from "./spatial-grid.js";
import { TickClock, TICK_SECONDS } from "./tick-clock.js";
import { firstObstacleHit } from "./obstacles2d.js";
import { bodyRadius, hasBodySpace, freeBirthPosition, firstBodyHit } from "./body-space.js";
import { drawStream, RNG_VERSION } from "./random.js";
import { makeCommand, sortCommands } from "./commands.js";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const desperate = (o) => o.role === "predator" &&
  o.energy + o.gutEnergy * o.assimilation < o.capacity * 0.35;
// Stable per-organism draws keep cosmetic genes and exploration headings from
// consuming the simulation's movement, mutation, or environment random streams.
function stableUnit(seed, id, salt) {
  let bits = (seed ^ Math.imul(id, 0x9e3779b9) ^ salt) >>> 0;
  bits = Math.imul(bits ^ (bits >>> 16), 0x85ebca6b);
  bits = Math.imul(bits ^ (bits >>> 13), 0xc2b2ae35);
  return ((bits ^ (bits >>> 16)) >>> 0) / 0x100000000;
}
export { TICK_SECONDS };
const MODEL_VERSION = "predator-v2";
const STATE_VERSION = 3;
export class TechnicalLimit extends Error {
  constructor(store, budget) {
    super(`${store} technical budget ${budget} reached`);
    this.store = store;
    this.budget = budget;
  }
}
/** A separate model version keeps P00 legacy characterization intact. */
export class PredatorWorld {
  constructor(seed = 90210, neural = DEFAULT_NEURAL, predators = 8, options = {}) {
    validateSeed(seed);
    numberInRange(predators, "predators", 0, 30, true);
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new TypeError("options must be an object");
    for (const key of Object.keys(options))
      if (!["width", "height", "prey", "food", "boundary", "fovDegrees", "budgets", "obstacles"].includes(key))
        throw new TypeError(`Unknown world option: ${key}`);
    const width = numberInRange(options.width ?? 1000, "width", 250, 4000, true);
    const height = numberInRange(options.height ?? 700, "height", 250, 4000, true);
    const prey = numberInRange(options.prey ?? 80, "prey", 0, 350, true);
    const food = numberInRange(options.food ?? 230, "food", 0, 650, true);
    const boundary = options.boundary ?? "reflect";
    const fovDegrees = numberInRange(options.fovDegrees ?? 360, "fovDegrees", 30, 360);
    if (!["reflect", "periodic"].includes(boundary)) throw new RangeError("Unknown boundary mode");
    this.modelVersion = MODEL_VERSION;
    this.stateVersion = STATE_VERSION;
    this.rngVersion = RNG_VERSION;
    this.width = width;
    this.height = height;
    this.boundary = boundary;
    this.fovDegrees = fovDegrees;
    if (options.obstacles !== undefined && !Array.isArray(options.obstacles))
      throw new TypeError("obstacles must be an array");
    this.obstacles = (options.obstacles ?? []).map((obstacle, index) => {
      if (!obstacle || typeof obstacle !== "object" || Array.isArray(obstacle) ||
          Object.keys(obstacle).some((key) => !["x", "y", "radius"].includes(key)))
        throw new TypeError(`Invalid obstacle ${index}`);
      return {
        x: numberInRange(obstacle.x, `obstacle ${index} x`, 0, width),
        y: numberInRange(obstacle.y, `obstacle ${index} y`, 0, height),
        radius: numberInRange(obstacle.radius, `obstacle ${index} radius`, 0.25, 100),
      };
    });
    if (options.budgets && (typeof options.budgets !== "object" || Array.isArray(options.budgets)))
      throw new TypeError("budgets must be an object");
    for (const key of Object.keys(options.budgets ?? {}))
      if (!["organisms", "food", "carcasses"].includes(key)) throw new TypeError(`Unknown budget: ${key}`);
    this.budgets = { organisms: 350, food: 650, carcasses: 350, ...options.budgets };
    for (const [key, value] of Object.entries(this.budgets))
      numberInRange(value, `budget.${key}`, 1, 100000, true);
    if (prey + predators > this.budgets.organisms || food > this.budgets.food)
      throw new RangeError("Initial entities exceed technical budget");
    this.initialPrey = prey;
    this.initialFood = food;
    this.initialPredators = predators;
    this.neural = Object.freeze(validateNeuralConfig(neural));
    this.parameters = parameterCount(this.neural);
    this.seed = seed;
    this.brainSeed = (seed + 12345) >>> 0;
    this.environmentSeed = (seed ^ 0x9e3779b9) >>> 0;
    this.mutationSeed = (seed ^ 0x85ebca6b) >>> 0;
    this.sensingSeed = (seed ^ 0xc2b2ae35) >>> 0;
    this.tick = 0;
    this.time = 0;
    this.accumulator = 0;
    this.clock = new TickClock();
    this.commands = [];
    this.nextCommandSequence = 1;
    this.commandLog = [];
    this.limitDiagnostic = null;
    this.nextId = 1;
    this.births = 0;
    this.kills = 0;
    this.cannibalKills = 0;
    this.attacks = 0;
    this.renewal = 60;
    this.mutation = 12;
    this.organisms = [];
    this.food = [];
    this.carcasses = [];
    this.history = [];
    this.roleHistory = [];
    this.events = [];
    this.recentDeaths = [];
    this.deaths = { predation: 0, starvation: 0, age: 0, impact: 0 };
    this.impacts = 0;
    this.lastImpact = null;
    this.blockedBirths = 0;
    this.crowdedBirths = 0;
    this.collisions = 0;
    this.limitReached = false;
    this.ledger = { initial: 0, input: 0, heat: 0, costs: {} };
    for (let i = 0; i < prey; i++) this.organisms.push(this.create("prey"));
    // Seed food before predators so predator-count comparisons share initial resources.
    for (let i = 0; i < food; i++) this.addFood(false);
    for (let i = 0; i < predators; i++)
      this.organisms.push(this.create("predator"));
    this.ledger.initial = this.storedEnergy();
    this.sample();
  }
  get renewal() {
    return this._renewal;
  }
  set renewal(v) {
    this._renewal = numberInRange(v, "renewal", 0, 100);
  }
  get mutation() {
    return this._mutation;
  }
  set mutation(v) {
    this._mutation = validateMutation(v);
  }
  random() {
    return drawStream(this, "seed");
  }
  brainRandom() {
    return drawStream(this, "brainSeed");
  }
  environmentRandom() {
    return drawStream(this, "environmentSeed");
  }
  mutationRandom() {
    return drawStream(this, "mutationSeed");
  }
  sensingRandom() {
    return drawStream(this, "sensingSeed");
  }
  create(role, parent) {
    const hunter = role === "predator",
      r = () => this.random(),
      mr = () => this.mutationRandom(),
      mutate = (v, a, b) =>
        clamp(
          v + (mr() < this.mutation / 100 ? (mr() - 0.5) * (b - a) * 0.35 : 0),
          a,
          b,
        );
    let x = parent ? parent.x : r() * this.width;
    let y = parent ? parent.y : r() * this.height;
    if (!parent) {
      const radius = hunter ? 10 * 1.7 : 7 * 1.45;
      const clear = () => hasBodySpace({ x, y }, radius, this.organisms, this.obstacles,
        this.width, this.height, this.boundary === "periodic");
      let attempts = 0;
      while (!clear() && attempts++ < 1000) { x = r() * this.width; y = r() * this.height; }
      if (!clear()) throw new RangeError("No free founder position after 1000 attempts");
    }
    const id = this.nextId++;
    const appearance = (salt) => stableUnit(this.seed, id, salt);
    const hue = parent
      ? clamp(parent.hue + (appearance(1) < this.mutation / 100
        ? (appearance(2) - 0.5) * 46 : 0), hunter ? 3 : 92, hunter ? 47 : 166)
      : hunter ? 9 + appearance(3) * 29 : 102 + appearance(3) * 55;
    const pattern = parent
      ? clamp(parent.pattern + (appearance(4) < this.mutation / 100
        ? (appearance(5) - 0.5) * 0.7 : 0), 0, 1)
      : appearance(6);
    return {
      id,
      role,
      parentId: parent?.id ?? null,
      generation: parent ? parent.generation + 1 : 1,
      x,
      y,
      angle: r() * Math.PI * 2,
      age: 0,
      energy: parent ? 55 : hunter ? 130 : 85 + r() * 30,
      capacity: hunter ? 230 : 170,
      gutEnergy: 0,
      gutCapacity: hunter ? 80 : 40,
      biteLimit: hunter ? 60 * TICK_SECONDS : 29,
      digestionRate: hunter ? 60 : 45,
      assimilation: hunter ? 0.8 : 0.75,
      tissueEnergy: 32,
      health: hunter ? 100 : 60,
      maxHealth: hunter ? 100 : 60,
      stamina: 100,
      maxStamina: 100,
      armor: 0,
      vx: 0,
      vy: 0,
      speed: parent
        ? mutate(parent.speed, hunter ? 30 : 18, hunter ? 65 : 48)
        : hunter
          ? 45 + r() * 10
          : 24 + r() * 12,
      sense: parent ? mutate(parent.sense, 60, 200) : hunter ? 150 : 110,
      size: parent
        ? mutate(parent.size, hunter ? 6 : 3, hunter ? 10 : 7)
        : hunter
          ? 7 + r() * 2
          : 4 + r() * 2,
      hue,
      pattern,
      brains: createBrains(
        this.neural,
        () => parent ? this.mutationRandom() : this.brainRandom(),
        parent?.brains,
        this.mutation,
      ),
      parameterCount: this.parameters,
      inputLabels: INPUTS,
      outputLabels: OUTPUTS,
      control: [0, 0, 0, 1, 1],
      traces: [],
      lastInputs: null,
      cooldownUntil: 0,
      nextBirthTick: 0,
      action: "searching",
      dead: false,
      lastAttackTick: -100,
    };
  }
  addFood(external = true) {
    if (this.food.length >= this.budgets.food) throw new TechnicalLimit("food", this.budgets.food);
    const random = external ? () => this.environmentRandom() : () => this.random();
    let x = random() * this.width, y = random() * this.height;
    if (this.obstacles.length) {
      const clear = () => this.obstacles.every((obstacle) =>
        displacement({ x, y }, obstacle, this.width, this.height, this.boundary === "periodic").squared > (obstacle.radius + 2) ** 2);
      let attempts = 0;
      while (!clear() && attempts++ < 100) { x = random() * this.width; y = random() * this.height; }
      if (!clear()) throw new RangeError("No free food position after 100 attempts");
    }
    const f = {
      id: this.nextId++,
      x,
      y,
      energy: 29,
    };
    this.food.push(f);
    if (external) this.ledger.input += 29;
  }
  schedule(command) {
    const record = makeCommand(this.tick, this.nextCommandSequence, command);
    this.nextCommandSequence++;
    this.commands.push(record);
    sortCommands(this.commands);
    return record;
  }
  applyCommands() {
    while (this.commands[0]?.tick === this.tick) {
      const command = this.commands.shift();
      if (command.type === "impact") {
        const x = this.width * (0.2 + this.environmentRandom() * 0.6);
        const y = this.height * (0.2 + this.environmentRandom() * 0.6);
        const radius = Math.min(this.width, this.height) * 0.32;
        let casualties = 0;
        for (const organism of this.organisms) {
          if (organism.dead || displacement({ x, y }, organism,
            this.width, this.height, this.boundary === "periodic").squared > radius ** 2) continue;
          this.die(organism, "impact");
          casualties++;
        }
        this.impacts++;
        this.lastImpact = { tick: this.tick, x, y, radius, casualties };
        this.events.push({ kind: "impact", x, y, radius, tick: this.tick, until: this.tick + 45 });
      } else if (command.type === "introducePredators") {
        if (this.organisms.length + command.value > this.budgets.organisms)
          throw new TechnicalLimit("organisms", this.budgets.organisms);
        for (let i = 0; i < command.value; i++) {
          const organism = this.create("predator");
          this.organisms.push(organism);
          this.ledger.input += organism.energy + organism.tissueEnergy;
        }
      } else {
        const previous = this[command.type];
        this[command.type] = command.value;
        command.previous = previous;
      }
      this.commandLog.push(command);
    }
  }
  rebuildSpatial() {
    this.spatial = new SpatialGrid(this.width, this.height, 64, this.boundary === "periodic")
      .load([...this.organisms.filter((o) => !o.dead), ...this.food, ...this.carcasses]);
  }
  localCandidates(o, radius, predicate) {
    const candidates = this.spatial
      ? this.spatial.query(o.x, o.y, radius)
      : [...this.organisms, ...this.food, ...this.carcasses];
    return candidates.filter((item) => item !== o && predicate(item));
  }
  nearest(o, items, radius = o.sense) {
    let best = null,
      dist = radius * radius;
    for (const item of items) {
      if (item.dead || item.energy <= 0) continue;
      const d = displacement(o, item, this.width, this.height, this.boundary === "periodic").squared;
      if (d < dist || (d === dist && best && item.id < best.id)) {
        best = item;
        dist = d;
      }
    }
    return best;
  }
  sense(o) {
    if (!this._inTick) this.rebuildSpatial();
    const c = Math.cos(o.angle), s = Math.sin(o.angle);
    const nearby = this.localCandidates(o, o.sense, (item) => {
      if (item.dead || item.energy <= 0) return false;
      const { dx, dy, squared } = displacement(o, item, this.width, this.height, this.boundary === "periodic");
      if (squared > o.sense ** 2) return false;
      if (this.obstacles.length && firstObstacleHit(o,
          { x: o.x + dx, y: o.y + dy }, this.obstacles,
          this.width, this.height, this.boundary === "periodic") !== null) return false;
      if (this.fovDegrees === 360 || squared === 0) return true;
      return (dx * c + dy * s) / Math.sqrt(squared) >= Math.cos(this.fovDegrees * Math.PI / 360);
    });
    const edible = nearby.filter((x) =>
      o.role === "prey" ? x.role === undefined : x.role === "prey",
    );
    const cannibalOptions = desperate(o) ? nearby.filter((x) => x.role === "predator") : [];
    const foodRaw = this.nearest(o, edible) ??
      this.nearest(o, cannibalOptions.filter((x) => x.sourceId !== undefined)) ??
      this.nearest(o, cannibalOptions.filter((x) => x.health !== undefined)),
      threatRaw = o.role === "prey"
        ? this.nearest(o, nearby.filter((x) => x.role === "predator" && x.health !== undefined))
        : null,
      previous = o.control;
    const record = (target) => {
      if (!target) return null;
      const delta = displacement(o, target, this.width, this.height, this.boundary === "periodic");
      return {
        id: target.id, x: target.x, y: target.y,
        role: target.role ?? null,
        kind: target.sourceId !== undefined ? "carcass" : target.health !== undefined ? "organism" : "food",
        health: target.health,
        size: target.size ?? 0,
        vx: target.vx ?? 0, vy: target.vy ?? 0,
        range: Math.sqrt(delta.squared),
      };
    };
    const food = record(foodRaw), threat = record(threatRaw);
    const local = (t) =>
      t
        ? (() => {
            const { dx, dy } = displacement(o, t, this.width, this.height, this.boundary === "periodic");
            return [(dx * c + dy * s) / o.sense, (-dx * s + dy * c) / o.sense, 1];
          })()
        : [0, 0, 0];
    const wx = this.boundary === "periodic" ? 0 : o.x < 60 ? 1 - o.x / 60 : o.x > this.width - 60 ? -(o.x - this.width + 60) / 60 : 0,
      wy = this.boundary === "periodic" ? 0 : o.y < 60 ? 1 - o.y / 60 : o.y > this.height - 60 ? -(o.y - this.height + 60) / 60 : 0;
    let goalKind, goalAngle;
    if (threat) {
      const d = displacement(o, threat, this.width, this.height, this.boundary === "periodic");
      goalKind = "escaping";
      goalAngle = Math.atan2(-d.dy, -d.dx);
    } else if (food) {
      const d = displacement(o, food, this.width, this.height, this.boundary === "periodic");
      goalKind = o.role === "prey" ? "foraging" : food.kind === "organism" ? "hunting" : "scavenging";
      goalAngle = d.squared < 1 ? o.angle : Math.atan2(d.dy, d.dx);
    } else if (wx * wx + wy * wy > 0.16) {
      goalKind = "avoiding wall";
      goalAngle = Math.atan2(wy, wx);
    } else {
      goalKind = "exploring";
      const epoch = Math.floor(this.tick / 300);
      goalAngle = stableUnit(this.seed, o.id, 0x12ca5e09 ^ epoch) * Math.PI * 2;
    }
    const goalTurn = clamp(angleDifference(goalAngle, o.angle) / (0.2 * 3), -1, 1);
    const radial = (t) => {
      if (!t) return 0;
      const { dx, dy, squared } = displacement(o, t, this.width, this.height, this.boundary === "periodic");
      if (squared === 0) return 0;
      return clamp((((t.vx ?? 0) - o.vx) * dx + ((t.vy ?? 0) - o.vy) * dy) / Math.sqrt(squared) / 100, -1, 1);
    };
    return {
      schemaVersion: OBSERVATION_VERSION,
      food,
      threat,
      goal: { kind: goalKind, turn: goalTurn },
      inputs: [
        ...local(food),
        ...local(threat),
        (o.energy / o.capacity) * 2 - 1,
        (o.health / o.maxHealth) * 2 - 1,
        wx * c + wy * s,
        -wx * s + wy * c,
        Math.sin(o.age * 2),
        (o.gutEnergy / o.gutCapacity) * 2 - 1,
        (o.stamina / o.maxStamina) * 2 - 1,
        o.cooldownUntil <= this.tick ? 1 : -1,
        radial(food),
        radial(threat),
        o.age >= 10 ? 1 : -1,
        previous[0] ?? 0,
        previous[1] ?? 0,
        previous[2] ?? 0,
        food?.size ? clamp(food.size / 20, 0, 1) : 0,
        threat?.size ? clamp(threat.size / 20, 0, 1) : 0,
        goalTurn,
      ],
    };
  }
  control(o, observation) {
    o.lastInputs = observation.inputs;
    if (o.brains.length) {
      const result = decide(o.brains, observation.inputs, false);
      const goal = observation.goal;
      const guidance = goal.kind === "escaping" || goal.kind === "avoiding wall" ? 0.85
        : goal.kind === "exploring" ? 0.6 : 0.75;
      o.control = [
        clamp(result.output[0] * (1 - guidance) + goal.turn * guidance, -1, 1),
        Math.max(result.output[1], -0.2),
        goal.kind === "hunting" ? Math.max(result.output[2], 0.1) : result.output[2],
        goal.kind === "foraging" || goal.kind === "scavenging"
          ? Math.max(result.output[3], 0.1) : result.output[3],
        result.output[4],
      ];
      o.traces = [];
      o.action = goal.kind;
      return;
    }
    const { food, inputs } = observation;
    let angle = o.angle + (this.sensingRandom() - 0.5) * 1.2;
    if (inputs[5]) {
      angle = o.angle + Math.atan2(-inputs[4], -inputs[3]);
      o.action = "fleeing";
    } else if (inputs[2]) {
      angle = o.angle + Math.atan2(inputs[1], inputs[0]);
      o.action =
        o.role === "prey"
          ? "foraging"
          : food?.kind === "organism"
            ? "hunting"
            : "scavenging";
    } else o.action = "searching";
    o.control = [
      clamp(angleDifference(angle, o.angle) / (0.2 * 3), -1, 1),
      1,
      o.role === "predator" ? 1 : -1,
      1,
      1,
    ];
  }
  spend(o, amount, cause = "maintenance") {
    const paid = Math.min(o.energy, Math.max(0, amount));
    o.energy -= paid;
    this.ledger.heat += paid;
    this.ledger.costs ??= {};
    this.ledger.costs[cause] = (this.ledger.costs[cause] ?? 0) + paid;
  }
  die(o, cause) {
    if (o.dead) return;
    if (this.carcasses.length >= this.budgets.carcasses)
      throw new TechnicalLimit("carcasses", this.budgets.carcasses);
    o.dead = true;
    this.deaths[cause]++;
    if (cause === "predation") {
      this.kills++;
      if (o.role === "predator") this.cannibalKills++;
    }
    this.carcasses.push({
      id: this.nextId++,
      sourceId: o.id,
      role: o.role,
      x: o.x,
      y: o.y,
      energy: o.energy + o.tissueEnergy + o.gutEnergy,
    });
    o.energy = 0;
    o.tissueEnergy = 0;
    o.gutEnergy = 0;
    const record = {
      id: o.id,
      role: o.role,
      age: o.age,
      cause,
      tick: this.tick,
      generation: o.generation,
    };
    this.recentDeaths.push(record);
    if (this.recentDeaths.length > 50) this.recentDeaths.shift();
  }
  resolveCombat() {
    if (!this._inTick) this.rebuildSpatial();
    const damage = new Map();
    for (const hunter of this.organisms) {
      if (
        hunter.dead ||
        hunter.role !== "predator" ||
        hunter.control[2] <= 0 ||
        hunter.cooldownUntil > this.tick ||
        hunter.energy < 2 || hunter.stamina < 10
      )
        continue;
      const candidates = this.localCandidates(hunter, bodyRadius(hunter) + 14, (p) =>
        !p.dead && p.health !== undefined &&
        (p.role === "prey" || (desperate(hunter) && p.role === "predator")) &&
        displacement(hunter, p, this.width, this.height, this.boundary === "periodic").squared <= (bodyRadius(hunter) + bodyRadius(p) + 3) ** 2 &&
        (() => { const d = displacement(hunter, p, this.width, this.height, this.boundary === "periodic");
          return firstObstacleHit(hunter, { x: hunter.x + d.dx, y: hunter.y + d.dy },
            this.obstacles, this.width, this.height, this.boundary === "periodic") === null; })(),
      );
      const preferred = this.nearest(hunter, candidates.filter((p) => p.role === "prey"), bodyRadius(hunter) + 14);
      const nearbyCarrion = !preferred && desperate(hunter) && this.localCandidates(hunter, hunter.size + 5,
        (c) => c.sourceId !== undefined && c.energy > 0 && (c.role === "prey" || c.role === "predator")).length > 0;
      const prey = preferred ?? (nearbyCarrion ? null :
        this.nearest(hunter, candidates.filter((p) => p.role === "predator"), bodyRadius(hunter) + 14));
      if (!prey) continue;
      this.spend(hunter, 2, "attack");
      hunter.stamina -= 10;
      hunter.cooldownUntil = this.tick + 15;
      hunter.lastAttackTick = this.tick;
      hunter.action = "attacking";
      this.attacks++;
      damage.set(prey.id, (damage.get(prey.id) || 0) + Math.max(0, 30 - prey.armor));
      this.events.push({
        x1: hunter.x,
        y1: hunter.y,
        x2: prey.x,
        y2: prey.y,
        until: this.tick + 6,
      });
    }
    for (const prey of this.organisms) {
      prey.health -= damage.get(prey.id) || 0;
      if (!prey.dead && prey.health <= 0) this.die(prey, "predation");
    }
    for (const o of this.organisms)
      if (!o.dead && o.energy <= 0) this.die(o, "starvation");
    if (this.events.length > 100)
      this.events.splice(0, this.events.length - 100);
  }
  feed() {
    if (!this._inTick) this.rebuildSpatial();
    // Tick-varying deterministic priority prevents array order or age winning all meals.
    const priority = (o) =>
      Math.imul((o.id ^ Math.imul(this.tick, 2654435761)) >>> 0, 2246822519) >>>
      0;
    const eaters = this.organisms
      .filter((o) => !o.dead)
      .sort((a, b) => priority(a) - priority(b) || a.id - b.id);
    for (const o of eaters) {
      if ((o.control[3] ?? 1) <= 0) continue;
      const resources = this.localCandidates(o, o.size + 5, (x) =>
        o.role === "prey" ? x.role === undefined : x.sourceId !== undefined &&
          (x.role === "prey" || (desperate(o) && x.role === "predator")),
      );
      const target = o.role === "prey" ? this.nearest(o, resources, o.size + 5) :
        this.nearest(o, resources.filter((x) => x.role === "prey"), o.size + 5) ??
        this.nearest(o, resources.filter((x) => x.role === "predator"), o.size + 5);
      if (!target) continue;
      const bite = Math.min(
        target.energy,
        o.gutCapacity - o.gutEnergy,
        o.biteLimit,
      );
      if (bite <= 0) continue;
      target.energy -= bite;
      o.gutEnergy += bite;
      o.action = "feeding";
    }
    this.food = this.food.filter((f) => f.energy > 1e-10);
    this.carcasses = this.carcasses.filter((c) => c.energy > 1e-10);
  }
  digest() {
    for (const o of this.organisms) {
      if (o.dead) continue;
      const efficiency = o.assimilation;
      const amount = Math.min(o.gutEnergy, o.digestionRate * TICK_SECONDS, (o.capacity - o.energy) / efficiency);
      if (amount > 0) {
        o.gutEnergy -= amount;
        o.energy += amount * efficiency;
        const loss = amount * (1 - efficiency);
        this.ledger.heat += loss;
        this.ledger.costs ??= {};
        this.ledger.costs.digestion = (this.ledger.costs.digestion ?? 0) + loss;
      }
      if (o.stamina < o.maxStamina && o.energy > 0) {
        const recovery = Math.min(o.maxStamina - o.stamina, 12 * TICK_SECONDS, o.energy / 0.05);
        o.stamina += recovery;
        this.spend(o, recovery * 0.05, "stamina");
      }
      if (o.health < o.maxHealth && o.energy > 0) {
        const repair = Math.min(o.maxHealth - o.health, TICK_SECONDS, o.energy / 0.3);
        o.health += repair;
        this.spend(o, repair * 0.3, "repair");
      }
      if (o.energy <= 0) this.die(o, "starvation");
    }
  }
  reproduce() {
    const children = [];
    for (const o of this.organisms) {
      if (
        o.dead ||
        o.energy <= (o.role === "predator" ? 180 : 140) ||
        o.age < 10 ||
        o.nextBirthTick > this.tick
        || (o.control[4] ?? 1) <= 0
      )
        continue;
      if (this.organisms.filter((x) => !x.dead).length + children.length >= this.budgets.organisms)
        throw new TechnicalLimit("organisms", this.budgets.organisms);
      const childRadius = o.role === "predator" ? 10 * 1.7 : 7 * 1.45;
      const position = freeBirthPosition(o, childRadius, this.organisms.concat(children),
        this.obstacles, this.width, this.height, this.boundary === "periodic");
      if (!position) { this.crowdedBirths++; o.action = "waiting for space"; continue; }
      o.energy -= 90;
      this.ledger.heat += 3;
      this.ledger.costs ??= {};
      this.ledger.costs.reproduction = (this.ledger.costs.reproduction ?? 0) + 3;
      const child = this.create(o.role, o);
      child.x = position.x;
      child.y = position.y;
      children.push(child);
      o.nextBirthTick = this.tick + 150;
      this.births++;
    }
    this.organisms = this.organisms.filter((o) => !o.dead).concat(children);
  }
  _stepTick() {
    this._inTick = true;
    this.tick++;
    this.time = this.tick * TICK_SECONDS;
    this.applyCommands();
    const arrivals = this.renewal * 0.18 * TICK_SECONDS;
    if (this.environmentRandom() < arrivals) this.addFood();
    for (const c of this.carcasses) {
      const decay = c.energy * 0.01 * TICK_SECONDS;
      c.energy -= decay;
      this.ledger.heat += decay;
    }
    for (const o of this.organisms) {
      o.age += TICK_SECONDS;
      if (o.energy <= 0) this.die(o, "starvation");
      else if (o.age >= (o.role === "predator" ? 200 : 160)) this.die(o, "age");
    }
    this.rebuildSpatial();
    if ((this.tick - 1) % 6 === 0) {
      const observations = this.organisms
        .filter((o) => !o.dead)
        .map((o) => [o, this.sense(o)]);
      for (const [o, observation] of observations) this.control(o, observation);
    }
    const priority = (o) =>
      Math.imul((o.id ^ Math.imul(this.tick, 2654435761)) >>> 0, 2246822519) >>> 0;
    const movers = this.organisms.filter((o) => !o.dead)
      .sort((a, b) => priority(a) - priority(b) || a.id - b.id);
    for (const o of movers) {
      if (o.dead) continue;
      const throttle = (o.control[1] + 1) / 2;
      o.angle += o.control[0] * 3 * TICK_SECONDS;
      const desiredX = Math.cos(o.angle) * o.speed * throttle;
      const desiredY = Math.sin(o.angle) * o.speed * throttle;
      const deltaX = desiredX - o.vx, deltaY = desiredY - o.vy;
      const delta = Math.hypot(deltaX, deltaY);
      const acceleration = 180 * TICK_SECONDS;
      const share = delta > acceleration ? acceleration / delta : 1;
      o.vx += deltaX * share;
      o.vy += deltaY * share;
      let nextX = o.x + o.vx * TICK_SECONDS;
      let nextY = o.y + o.vy * TICK_SECONDS;
      const obstacleHit = firstObstacleHit(o, { x: nextX, y: nextY },
        this.obstacles, this.width, this.height, this.boundary === "periodic", bodyRadius(o));
      const bodyHit = firstBodyHit(o, { x: nextX, y: nextY }, o, this.organisms,
        this.width, this.height, this.boundary === "periodic");
      const firstHit = Math.min(obstacleHit ?? 1, bodyHit?.fraction ?? 1);
      if (firstHit < 1) {
        const share = Math.max(0, firstHit - 1e-6);
        nextX = o.x + o.vx * TICK_SECONDS * share;
        nextY = o.y + o.vy * TICK_SECONDS * share;
        o.vx = 0; o.vy = 0;
        if (bodyHit && bodyHit.fraction <= (obstacleHit ?? 1)) this.collisions++;
      }
      if (this.boundary === "periodic") {
        o.x = ((nextX % this.width) + this.width) % this.width;
        o.y = ((nextY % this.height) + this.height) % this.height;
      } else {
        const radius = bodyRadius(o);
        o.x = clamp(nextX, radius, this.width - radius);
        o.y = clamp(nextY, radius, this.height - radius);
        if (o.x !== nextX) o.vx *= -1;
        if (o.y !== nextY) o.vy *= -1;
        if (o.x !== nextX || o.y !== nextY) o.angle += Math.PI;
      }
      this.spend(o, TICK_SECONDS * (0.7 + o.size * 0.07), "basal");
      this.spend(o, TICK_SECONDS * Math.hypot(o.vx, o.vy) * 0.022, "locomotion");
      this.spend(o, TICK_SECONDS * o.sense * 0.004, "sensing");
      this.spend(o, TICK_SECONDS * o.parameterCount * 0.00015, "controller");
      if (o.energy <= 0) this.die(o, "starvation");
    }
    this.rebuildSpatial();
    this.resolveCombat();
    this.rebuildSpatial();
    this.feed();
    this.digest();
    this.reproduce();
    this.events = this.events.filter((e) => e.until >= this.tick);
    if (this.tick % 30 === 0) this.sample();
    this._inTick = false;
    this.spatial = null;
    return { tick: this.tick, population: this.organisms.length, births: this.births, deaths: { ...this.deaths } };
  }
  needsTickCheckpoint() {
    // A tick can add one food item, one child per living parent, and one
    // carcass per organism. Introductions may add organisms before those steps.
    // Only ticks that could hit a technical budget need a rollback copy.
    const nextTick = this.tick + 1;
    let introductions = 0;
    for (const command of this.commands) {
      if (command.tick > nextTick) break;
      if (command.tick === nextTick && command.type === "introducePredators")
        introductions += command.value;
    }
    const possibleOrganisms = this.organisms.length + introductions;
    return this.food.length >= this.budgets.food ||
      this.carcasses.length + possibleOrganisms > this.budgets.carcasses ||
      possibleOrganisms * 2 > this.budgets.organisms;
  }
  stepTick() {
    if (this.limitDiagnostic) return null;
    if (!this.needsTickCheckpoint()) return this._stepTick();
    const state = this.exportState();
    const staged = PredatorWorld.restore(state);
    try {
      const summary = staged._stepTick();
      Object.assign(this, staged);
      return summary;
    } catch (error) {
      if (!(error instanceof TechnicalLimit)) throw error;
      this.limitReached = true;
      this.limitDiagnostic = { tick: this.tick + 1, store: error.store, budget: error.budget };
      return null;
    }
  }
  step(dt) {
    numberInRange(dt, "dt", Number.MIN_VALUE, 1);
    const ticks = this.clock.request(dt);
    for (let i = 0; i < ticks && !this.limitDiagnostic; i++) this.stepTick();
    this.accumulator = this.clock.remainder * TICK_SECONDS;
  }
  raiseBudget(store, value) {
    if (!Object.hasOwn(this.budgets, store)) throw new RangeError("Unknown budget store");
    numberInRange(value, `budget.${store}`, this.budgets[store] + 1, 100000, true);
    this.budgets[store] = value;
    this.limitDiagnostic = null;
    this.limitReached = false;
  }
  exportState() {
    const entries = Object.entries(this).filter(([key]) =>
      key !== "spatial" && key !== "_inTick" && key !== "clock" && key !== "limitDiagnostic" && key !== "limitReached" && key !== "accumulator",
    );
    return structuredClone({ ...Object.fromEntries(entries), clockRemainder: this.clock.remainder });
  }
  static restore(state) {
    if (state?.modelVersion !== MODEL_VERSION || ![2, STATE_VERSION].includes(state?.stateVersion) || state?.rngVersion !== RNG_VERSION)
      throw new RangeError("Unsupported predator checkpoint version");
    const migrated = structuredClone(state);
    if (migrated.stateVersion === 2) {
      // Keep older learned weights and biases in place; the new goal input
      // starts with a neutral weight and can evolve in descendants.
      for (const organism of migrated.organisms) {
        for (const network of organism.brains)
          for (const row of network[0]) {
            if (row.length !== INPUTS.length) throw new RangeError("Invalid 22-input checkpoint brain");
            row.splice(-1, 0, 0);
          }
        organism.inputLabels = INPUTS;
        organism.lastInputs = null;
        organism.parameterCount = parameterCount(migrated.neural);
      }
      migrated.parameters = parameterCount(migrated.neural);
      migrated.stateVersion = STATE_VERSION;
    }
    const world = Object.create(PredatorWorld.prototype);
    Object.assign(world, migrated);
    for (const organism of world.organisms) organism.pattern ??= 0.5;
    world.deaths.impact ??= 0;
    world.cannibalKills ??= 0;
    world.impacts ??= 0;
    world.lastImpact ??= null;
    world.crowdedBirths ??= 0;
    world.collisions ??= 0;
    world.neural = Object.freeze(validateNeuralConfig(migrated.neural));
    validateSeed(world.seed);
    validateSeed(world.brainSeed);
    validateSeed(world.environmentSeed);
    validateSeed(world.mutationSeed);
    validateSeed(world.sensingSeed);
    numberInRange(migrated.clockRemainder, "clock remainder", 0, 1);
    world.clock = new TickClock();
    world.clock.remainder = migrated.clockRemainder;
    delete world.clockRemainder;
    world.accumulator = world.clock.remainder * TICK_SECONDS;
    world.limitDiagnostic = null;
    world.limitReached = false;
    world.spatial = null;
    world._inTick = false;
    return world;
  }
  stateKey() {
    const state = this.exportState();
    delete state.clockRemainder;
    return JSON.stringify(state);
  }
  sample() {
    const prey = this.organisms.filter((o) => o.role === "prey").length,
      predators = this.organisms.length - prey;
    this.history.push(prey + predators);
    this.roleHistory.push({ time: this.time, prey, predators });
    if (this.history.length > 120) {
      this.history.shift();
      this.roleHistory.shift();
    }
  }
  storedEnergy() {
    return (
      this.organisms.reduce(
        (n, o) => n + (o.dead ? 0 : o.energy + o.gutEnergy + o.tissueEnergy),
        0,
      ) +
      this.food.reduce((n, f) => n + f.energy, 0) +
      this.carcasses.reduce((n, c) => n + c.energy, 0)
    );
  }
  energyResidual() {
    return (
      this.storedEnergy() -
      this.ledger.initial -
      this.ledger.input +
      this.ledger.heat
    );
  }
}

export function createWorld(config = {}, seed = 90210) {
  const { neural = DEFAULT_NEURAL, predators = 8, ...options } = config;
  return new PredatorWorld(seed, neural, predators, options);
}

export function stepWorld(world, commandsForTick = []) {
  for (const command of commandsForTick)
    world.schedule({ ...command, tick: world.tick + 1 });
  return world.stepTick();
}

export function makeRenderSnapshot(world, selectedId = null) {
  return {
    modelVersion: world.modelVersion,
    tick: world.tick,
    time: world.time,
    width: world.width,
    height: world.height,
    boundary: world.boundary,
    obstacles: world.obstacles.map((obstacle) => ({ ...obstacle })),
    selectedId,
    organisms: world.organisms.map(({ id, role, x, y, angle, size, speed, health, maxHealth, sense, hue, pattern }) =>
      ({ id, role, x, y, angle, size, speed, health, maxHealth, sense, hue, pattern })),
    food: world.food.map(({ id, x, y, energy }) => ({ id, x, y, energy })),
    carcasses: world.carcasses.map(({ id, x, y, energy }) => ({ id, x, y, energy })),
    events: world.events.map((event) => ({ ...event })),
  };
}
