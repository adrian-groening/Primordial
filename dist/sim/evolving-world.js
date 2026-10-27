import { PredatorWorld } from "./predator-world.js";
import { drawStream } from "./random.js";
import { displacement } from "./spatial-grid.js";
import { numberInRange } from "./config.js";
import { DEFAULT_NEURAL, INPUTS, OUTPUTS, OBSERVATION_VERSION, validateArchitecture,
  createBrains, reshapeBrains, parameterCount, decide, teach, updatePolicy } from "./evolving-neural.js";

const RULE = Object.freeze({ count: 0, depth: 1, width: 6 });
const clamp = (value, min = -1, max = 1) => Math.max(min, Math.min(max, value));
const TRAITS = { plasticity: [0.004, 0.025], retention: [0.3, 0.95], autonomy: [0.2, 0.9],
  dash: [0.2, 1], shield: [0.05, 1], camouflage: [0.05, 1], metabolism: [0.6, 0.92], endurance: [80, 160] };
export const MODEL_VERSION = "predator-v3";
export class EvolvingWorld extends PredatorWorld {
  constructor(seed = 90210, neural = DEFAULT_NEURAL, predators = 8, options = {}) {
    const { intelligence, ...physical } = options;
    const shape = validateArchitecture(neural);
    super(seed, RULE, predators, { width: 1200, height: 800, ...physical });
    this.modelVersion = MODEL_VERSION; this.stateVersion = 4;
    this.neural = Object.freeze(shape); this.parameters = parameterCount(shape);
    this.learningSeed = (seed ^ 0xa511e9b3) >>> 0;
    this.abilitySeed = (seed ^ 0x63d83595) >>> 0;
    this.intelligence = { enabled: true, bootstrap: true, rate: 1 };
    this.learningUpdates = 0;
    this.abilityStats = { dashes: 0, shields: 0, signals: 0, rests: 0, concealments: 0, variants: 0 };
    for (const o of this.organisms) this.initializeMind(o);
    if (intelligence !== undefined) this.configureIntelligence(intelligence);
  }
  abilityRandom() { return drawStream(this, "abilitySeed"); }
  learningRandom() { return drawStream(this, "learningSeed"); }
  initializeMind(o, parent = null, previousBrains = null) {
    const genes = {};
    let changed = false;
    for (const [key, [min, max]] of Object.entries(TRAITS)) {
      if (!parent) genes[key] = min + (max - min) * (0.25 + this.abilityRandom() * 0.5);
      else {
        const mutate = this.mutationRandom() < this.mutation / 100;
        genes[key] = clamp(parent.genes[key] + (mutate ? (this.mutationRandom() - 0.5) * (max - min) * 0.3 : 0), min, max);
        changed ||= genes[key] !== parent.genes[key];
      }
    }
    o.genes = genes;
    o.genome = previousBrains?.length
      ? reshapeBrains(previousBrains, this.neural, () => this.brainRandom())
      : createBrains(this.neural, () => parent ? this.mutationRandom() : this.brainRandom(), parent?.genome, this.mutation);
    o.brains = structuredClone(o.genome);
    o.parameterCount = this.parameters; o.inputLabels = INPUTS; o.outputLabels = OUTPUTS;
    o.control = [0, 0.4, -1, 1, 1, -1, -1, -1, -1, -1];
    o.lastInputs = null; o.traces = []; delete o.brainArchive;
    o.assimilation = genes.metabolism;
    o.maxStamina = genes.endurance; o.stamina = Math.min(o.stamina, o.maxStamina);
    o.mind = { memory: [0, 0, 0, 0], foodMemory: null, updates: 0, baseline: 0,
      reward: 0, totalReward: 0, loss: 1, weightChange: 0, offspring: 0,
      autonomy: 0.25, transition: null, lastOutcome: "No experience yet" };
    o.abilities = { dashUntil: 0, dashReady: 0, shieldUntil: 0, shieldReady: 0,
      restUntil: 0, concealUntil: 0, signalReady: 0, signal: null, used: { dash: 0, shield: 0, signal: 0, rest: 0, camouflage: 0 } };
    if (parent) { parent.mind.offspring++; if (changed) this.abilityStats.variants++; }
    return o;
  }
  create(role, parent) {
    if (!this.intelligence) return super.create(role, parent);
    const neural = this.neural, parameters = this.parameters;
    this.neural = RULE; this.parameters = 0;
    let o;
    try { o = super.create(role, parent ? { ...parent, brains: [] } : undefined); }
    finally { this.neural = neural; this.parameters = parameters; }
    return this.initializeMind(o, parent);
  }
  configureIntelligence(settings) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings) ||
      Object.keys(settings).some((key) => !["enabled", "bootstrap", "rate"].includes(key))) throw new TypeError("Invalid intelligence settings");
    const next = { ...this.intelligence, ...settings };
    for (const key of ["enabled", "bootstrap"]) if (typeof next[key] !== "boolean") throw new TypeError(`${key} must be boolean`);
    numberInRange(next.rate, "learning rate", 0, 3);
    this.intelligence = next;
  }
  _applyLiveSettings(settings) {
    if (Object.keys(settings).some((key) => !["width", "height", "boundary", "fovDegrees", "prey", "predators", "food", "budgets", "neural", "intelligence"].includes(key)))
      throw new TypeError("Unknown evolving world setting");
    const { neural, intelligence, ...physical } = settings;
    const shape = neural ? validateArchitecture(neural) : this.neural;
    if (intelligence !== undefined) this.configureIntelligence(intelligence);
    const result = super._applyLiveSettings(physical);
    if (JSON.stringify(shape) !== JSON.stringify(this.neural)) {
      this.neural = Object.freeze(shape); this.parameters = parameterCount(shape);
      for (const o of this.organisms) {
        o.brains = reshapeBrains(o.brains, shape, () => this.brainRandom());
        o.genome = reshapeBrains(o.genome, shape, () => this.brainRandom());
        o.parameterCount = this.parameters; o.mind.transition = null; o.lastInputs = null;
      }
    }
    return result;
  }
  applyLiveSettings(settings = {}) {
    // Parent staging preserves atomic edits, including abilities and learning state.
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new TypeError("Invalid live world setting");
    const staged = this.constructor.restore(this.exportState());
    const result = staged._applyLiveSettings(settings);
    staged.limitDiagnostic = this.limitDiagnostic; staged.limitReached = this.limitReached;
    if (this.limitDiagnostic && staged.budgets[this.limitDiagnostic.store] > this.limitDiagnostic.budget) {
      staged.limitDiagnostic = null; staged.limitReached = false;
    }
    Object.assign(this, staged); return result;
  }
  sense(o) {
    const observation = super.sense(o), m = o.mind;
    if (observation.food) m.foodMemory = { x: observation.food.x, y: observation.food.y, tick: this.tick };
    const expiry = 90 + Math.round(o.genes.retention * 720);
    if (m.foodMemory && (this.tick - m.foodMemory.tick > expiry ||
      !observation.food && displacement(o, m.foodMemory, this.width, this.height, this.boundary === "periodic").squared < (o.size + 8) ** 2)) m.foodMemory = null;
    const local = (target, scale = o.sense) => {
      if (!target) return [0, 0];
      const { dx, dy } = displacement(o, target, this.width, this.height, this.boundary === "periodic");
      return [clamp((dx * Math.cos(o.angle) + dy * Math.sin(o.angle)) / scale),
        clamp((-dx * Math.sin(o.angle) + dy * Math.cos(o.angle)) / scale)];
    };
    const memory = local(m.foodMemory, Math.max(200, o.sense));
    if (!observation.food && !observation.threat && m.foodMemory && observation.goal.kind === "exploring") {
      const d = displacement(o, m.foodMemory, this.width, this.height, this.boundary === "periodic");
      const angle = Math.atan2(d.dy, d.dx) - o.angle;
      observation.goal = { kind: "remembered foraging", turn: clamp(Math.atan2(Math.sin(angle), Math.cos(angle)) / 0.6) };
      observation.inputs[22] = observation.goal.turn;
    }
    const signals = this.localCandidates(o, o.sense, (other) => other.role === o.role &&
      !other.dead && other.abilities?.signal?.until >= this.tick);
    const signal = this.nearest(o, signals);
    observation.signal = signal ? { x: signal.x, y: signal.y, value: signal.abilities.signal.value } : null;
    observation.inputs.push(...m.memory, clamp(m.reward), o.abilities.dashReady <= this.tick ? 1 : -1,
      o.genes.shield, observation.signal?.value ?? 0, ...memory,
      m.foodMemory ? clamp(1 - (this.tick - m.foodMemory.tick) / expiry, 0, 1) : 0,
      ...local(observation.signal), o.abilities.concealUntil >= this.tick ? o.genes.camouflage : 0);
    observation.schemaVersion = OBSERVATION_VERSION;
    return observation;
  }
  canDetect(observer, other, squared) {
    if (other.role !== "prey" || observer.role !== "predator" || !other.abilities || other.abilities.concealUntil < this.tick) return true;
    const reach = Math.max(25, observer.sense * (1 - 0.65 * other.genes.camouflage));
    return squared <= reach ** 2;
  }
  movementSpeed(o) {
    if (o.abilities.restUntil >= this.tick) return o.speed * 0.08;
    return o.speed * (o.abilities.dashUntil >= this.tick ? 1 + o.genes.dash * 1.5 : 1);
  }
  spend(o, amount, cause) {
    if (cause === "basal" && o.abilities?.restUntil >= this.tick) amount *= 0.55;
    return super.spend(o, amount, cause);
  }
  _stepTick() {
    for (const o of this.organisms) o.armor = o.abilities.shieldUntil >= this.tick + 1 ? 30 * o.genes.shield : 0;
    return super._stepTick();
  }
  rewardFor(o, transition) {
    const offspring = o.mind.offspring - transition.offspring;
    const energy = o.energy + o.gutEnergy * o.assimilation;
    let reward = clamp((energy - transition.energy + offspring * 90) / 15) +
      clamp((o.health - transition.health) / 15, -1, 0) + offspring * 1.2;
    if (transition.target) {
      const distance = Math.sqrt(displacement(o, transition.target, this.width, this.height, this.boundary === "periodic").squared);
      const progress = (transition.distance - distance) * (transition.escaping ? -1 : 1);
      reward += clamp(progress / 20, -0.2, 0.2);
    }
    if (displacement(o, transition.position, this.width, this.height, this.boundary === "periodic").squared < 0.25 && transition.throttle > 0.4) reward -= 0.06;
    return clamp(reward, -2, 2);
  }
  control(o, observation) {
    const m = o.mind, g = o.genes, a = o.abilities;
    const energyAtDecision = o.energy + o.gutEnergy * o.assimilation;
    const learning = this.intelligence.enabled && this.intelligence.rate > 0;
    const rate = g.plasticity * this.intelligence.rate;
    if (m.transition) {
      const reward = this.rewardFor(o, m.transition), advantage = clamp(reward - m.baseline);
      m.reward = reward; m.totalReward += reward; m.baseline = m.baseline * 0.95 + reward * 0.05;
      m.lastOutcome = reward > 0.02 ? "Useful outcome" : reward < -0.02 ? "Costly outcome" : "Neutral outcome";
      if (learning) {
        const gradient = m.transition.samples.map((sample, i) => i < 10 ? advantage * (sample - m.transition.output[i]) / (0.1 ** 2) : 0);
        m.weightChange += updatePolicy(o.brains, m.transition.traces, gradient, rate * 0.025);
        m.updates++;
        this.learningUpdates++;
        this.spend(o, o.parameterCount * 0.000015, "learning");
      }
    }
    const food = observation.food, threat = observation.threat;
    const fertile = o.age >= 10 && o.energy > (o.role === "predator" ? 180 : 140) && o.nextBirthTick <= this.tick;
    const tired = o.stamina / o.maxStamina < 0.3 && !threat;
    const targets = [observation.goal.turn, tired ? -0.6 : 0.6,
      food?.kind === "organism" ? 0.9 : -0.8, food ? 0.9 : -0.5, fertile ? 0.9 : -0.6,
      threat || food?.kind === "organism" && food.range < 100 ? 0.7 : -0.7,
      threat && threat.range < 80 ? 0.8 : -0.7, food || threat ? 0.65 : -0.65,
      tired ? 0.85 : -0.8, o.role === "prey" && threat && o.stamina < 40 ? 0.8 : -0.8,
      food ? observation.inputs[0] : m.memory[0] * g.retention,
      food ? observation.inputs[1] : m.memory[1] * g.retention,
      threat ? 1 : m.memory[2] * g.retention, clamp(m.reward)];
    if (learning && this.intelligence.bootstrap) {
      const trained = teach(o.brains, observation.inputs, targets, rate);
      m.loss = m.loss * 0.9 + trained.loss * 0.1;
      m.weightChange += trained.change;
    }
    const result = decide(o.brains, observation.inputs);
    const samples = result.output.map((value, i) => {
      if (!learning || i >= 10) return value;
      const noise = Math.sqrt(-2 * Math.log(Math.max(1e-10, this.learningRandom()))) * Math.cos(2 * Math.PI * this.learningRandom());
      return value + noise * 0.1;
    });
    const learned = samples.map((value) => clamp(value));
    const progress = Math.min(1, m.updates / 80) * clamp(1 - m.loss, 0, 1);
    const guidance = (threat ? 0.8 : 0.65) * (1 - g.autonomy * progress);
    m.autonomy = 1 - guidance;
    o.control = learned.slice(0, 10);
    o.control[0] = clamp(learned[0] * (1 - guidance) + observation.goal.turn * guidance);
    o.control[1] = Math.max(learned[1], -0.2 + progress * -0.4);
    if (food && progress < 0.6) { o.control[3] = Math.max(0.1, learned[3]); if (food.kind === "organism") o.control[2] = Math.max(0.1, learned[2]); }
    o.lastInputs = observation.inputs; o.traces = []; o.action = observation.goal.kind;
    m.memory = result.output.slice(10).map((value, i) => clamp(m.memory[i] * g.retention + value * (1 - g.retention)));
    const use = (index, key, energy, stamina, ready, duration, cooldown) => {
      if (learned[index] <= 0.2 || this.tick < a[ready] || o.energy < energy || o.stamina < stamina) return false;
      this.spend(o, energy, key); o.stamina -= stamina;
      if (ready) a[ready] = this.tick + cooldown;
      a[`${key === "camouflage" ? "conceal" : key}Until`] = this.tick + duration;
      a.used[key]++; return true;
    };
    if (use(5, "dash", 2, 18, "dashReady", 9, 60)) { this.abilityStats.dashes++; o.action = "dashing"; }
    if (use(6, "shield", 0.8, 5, "shieldReady", 6, 12)) { this.abilityStats.shields++; o.armor = 30 * g.shield; o.action = "defending"; }
    if (learned[7] > 0.2 && this.tick >= a.signalReady && o.energy >= 0.4 && (food || threat)) {
      this.spend(o, 0.4, "signal"); a.signalReady = this.tick + 30;
      a.signal = { value: threat ? -1 : 1, until: this.tick + 30 };
      a.used.signal++; this.abilityStats.signals++; o.action = "signaling";
    }
    if (learned[8] > 0.2 && !threat && o.stamina < o.maxStamina * 0.6) {
      a.restUntil = this.tick + 6; a.used.rest++; this.abilityStats.rests++; o.action = "resting";
    }
    if (o.role === "prey" && use(9, "camouflage", 0.3, 1, "", 6, 0)) { this.abilityStats.concealments++; o.action = "concealing"; }
    const target = threat ?? food ?? m.foodMemory;
    m.transition = { traces: result.traces, output: result.output, samples,
      energy: energyAtDecision, health: o.health,
      offspring: m.offspring, position: { x: o.x, y: o.y }, throttle: (o.control[1] + 1) / 2,
      target: target ? { x: target.x, y: target.y } : null,
      distance: target ? Math.sqrt(displacement(o, target, this.width, this.height, this.boundary === "periodic").squared) : 0,
      escaping: !!threat };
  }
  static restore(state) {
    if (state?.modelVersion === "predator-v2") return this.fromLegacy(PredatorWorld.restore(state));
    if (state?.modelVersion !== MODEL_VERSION || state.stateVersion !== 4) throw new RangeError("Unsupported evolving checkpoint");
    const world = PredatorWorld.restore({ ...state, modelVersion: "predator-v2", stateVersion: 3 });
    Object.setPrototypeOf(world, this.prototype);
    world.modelVersion = MODEL_VERSION; world.stateVersion = 4;
    validateArchitecture(world.neural);
    world.configureIntelligence(world.intelligence);
    for (const o of world.organisms) {
      if (!o.mind || !o.genes || !o.abilities) throw new RangeError("Incomplete evolving organism checkpoint");
    }
    return world;
  }
  static fromLegacy(legacy) {
    Object.setPrototypeOf(legacy, this.prototype);
    legacy.modelVersion = MODEL_VERSION; legacy.stateVersion = 4;
    legacy.neural = Object.freeze(legacy.neural.count ? { ...legacy.neural } : { ...DEFAULT_NEURAL });
    legacy.parameters = parameterCount(legacy.neural);
    legacy.learningSeed = (legacy.seed ^ 0xa511e9b3) >>> 0;
    legacy.abilitySeed = (legacy.seed ^ 0x63d83595) >>> 0;
    legacy.intelligence = { enabled: true, bootstrap: true, rate: 1 };
    legacy.learningUpdates = 0;
    legacy.abilityStats = { dashes: 0, shields: 0, signals: 0, rests: 0, concealments: 0, variants: 0 };
    for (const o of legacy.organisms) legacy.initializeMind(o, null, o.brains);
    return legacy;
  }
}
