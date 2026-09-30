import {
  DEFAULT_NEURAL,
  validateSeed,
  validateNeuralConfig,
  validateExperimentConfig,
  validateMutation,
  numberInRange,
} from "./sim/config.js";
import { createBrains, decide, parameterCount } from "./neural.js";
// Simulation state and genetics are independent of rendering and UI.
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export class Ecosystem {
  constructor(seed = 90210, neural = DEFAULT_NEURAL) {
    validateSeed(seed);
    this.neural = Object.freeze(validateNeuralConfig(neural));
    this.initialSeed = seed;
    this.parameters = parameterCount(this.neural);
    this.seed = seed;
    this.brainSeed = (seed + 12345) >>> 0;
    this.time = 0;
    this.nextId = 1;
    this.births = 0;
    this.organisms = [];
    this.food = [];
    this.renewal = 60;
    this.mutation = 12;
    this.history = [];
    this.lastSample = -1;
    for (let i = 0; i < 64; i++) this.organisms.push(this.create());
    for (let i = 0; i < 230; i++) this.addFood();
  }
  static fromConfig(input) {
    const config = validateExperimentConfig(input);
    const sim = new Ecosystem(config.seed, config.neural);
    sim.renewal = config.renewal;
    sim.mutation = config.mutation;
    return sim;
  }
  get renewal() {
    return this._renewal;
  }
  set renewal(value) {
    this._renewal = numberInRange(value, "renewal", 0, 100);
  }
  get mutation() {
    return this._mutation;
  }
  set mutation(value) {
    this._mutation = validateMutation(value);
  }
  random() {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  brainRandom() {
    this.brainSeed = (1664525 * this.brainSeed + 1013904223) >>> 0;
    return this.brainSeed / 4294967296;
  }
  create(parent) {
    const r = () => this.random();
    const mutate = (v, min, max) =>
      clamp(
        v + (r() < this.mutation / 100 ? (r() - 0.5) * (max - min) * 0.35 : 0),
        min,
        max,
      );
    return {
      brains: createBrains(
        this.neural,
        () => this.brainRandom(),
        parent?.brains,
        this.mutation,
      ),
      decisionAt: 0,
      control: [0, 0],
      traces: [],
      id: this.nextId++,
      x: parent ? parent.x : r() * 1000,
      y: parent ? parent.y : r() * 700,
      angle: r() * Math.PI * 2,
      energy: parent ? 65 : 65 + r() * 50,
      age: 0,
      generation: parent ? parent.generation + 1 : 1,
      speed: parent ? mutate(parent.speed, 12, 60) : 18 + r() * 22,
      sense: parent ? mutate(parent.sense, 35, 170) : 60 + r() * 50,
      size: parent ? mutate(parent.size, 3, 9) : 4 + r() * 2,
      hue: parent ? mutate(parent.hue, 75, 180) : 85 + r() * 75,
    };
  }
  addFood() {
    if (this.food.length < 650)
      this.food.push({ x: this.random() * 1000, y: this.random() * 700 });
  }
  step(dt) {
    numberInRange(dt, "dt", Number.MIN_VALUE, 1);
    this.time += dt;
    const count = this.renewal * 0.18 * dt;
    for (let i = 0; i < Math.floor(count); i++) this.addFood();
    if (this.random() < count % 1) this.addFood();
    const children = [];
    for (const o of this.organisms) {
      o.age += dt;
      let target = null,
        nearest = o.sense * o.sense;
      for (const f of this.food) {
        const d = (f.x - o.x) ** 2 + (f.y - o.y) ** 2;
        if (d < nearest) {
          nearest = d;
          target = f;
        }
      }
      let throttle = 1;
      if (o.brains.length) {
        if (this.time >= o.decisionAt) {
          const dx = target ? (target.x - o.x) / o.sense : 0,
            dy = target ? (target.y - o.y) / o.sense : 0,
            c = Math.cos(o.angle),
            s = Math.sin(o.angle);
          const wx =
              o.x < 60 ? 1 - o.x / 60 : o.x > 940 ? -(o.x - 940) / 60 : 0,
            wy = o.y < 60 ? 1 - o.y / 60 : o.y > 640 ? -(o.y - 640) / 60 : 0;
          const result = decide(o.brains, [
            dx * c + dy * s,
            -dx * s + dy * c,
            target ? 1 : 0,
            o.energy / 85 - 1,
            wx * c + wy * s,
            -wx * s + wy * c,
            Math.sin(o.age * 2),
          ]);
          o.control = result.output;
          o.traces = result.traces;
          o.decisionAt = this.time + 0.2;
        }
        o.angle += o.control[0] * 3 * dt;
        throttle = 0.15 + (0.85 * (o.control[1] + 1)) / 2;
      } else if (target) o.angle = Math.atan2(target.y - o.y, target.x - o.x);
      else o.angle += (this.random() - 0.5) * 2 * Math.sqrt(dt);
      o.x = clamp(o.x + Math.cos(o.angle) * o.speed * throttle * dt, 0, 1000);
      o.y = clamp(o.y + Math.sin(o.angle) * o.speed * throttle * dt, 0, 700);
      if (o.x === 0 || o.x === 1000 || o.y === 0 || o.y === 700)
        o.angle += Math.PI;
      o.energy -=
        dt *
        (0.7 +
          o.speed * throttle * 0.022 +
          o.sense * 0.004 +
          o.size * 0.07 +
          this.parameters * 0.00015);
      if (target && nearest < (o.size + 5) ** 2) {
        const ix = this.food.indexOf(target);
        if (ix >= 0) {
          this.food.splice(ix, 1);
          o.energy = Math.min(170, o.energy + 29);
        }
      }
      if (
        o.energy > 135 &&
        o.age > 7 &&
        this.organisms.length + children.length < 350
      ) {
        o.energy -= 68;
        children.push(this.create(o));
        this.births++;
      }
    }
    this.organisms = this.organisms
      .filter((o) => o.energy > 0 && o.age < 160)
      .concat(children);
    if (Math.floor(this.time) !== this.lastSample) {
      this.lastSample = Math.floor(this.time);
      this.history.push(this.organisms.length);
      if (this.history.length > 120) this.history.shift();
    }
  }
}
