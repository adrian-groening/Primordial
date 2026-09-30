import {
  DEFAULT_NEURAL,
  validateSeed,
  validateNeuralConfig,
  numberInRange,
  validateMutation,
} from "./config.js";
import {
  createBrains,
  decide,
  parameterCount,
  INPUTS,
  OUTPUTS,
} from "./planet-neural.js";
import {
  RADIUS,
  clamp,
  dot,
  add,
  scale,
  norm,
  cross,
  tangent,
  basis,
  distance,
  walk,
  offset,
  randomPoint,
} from "./sphere.js";
import {
  founderDNA,
  inheritDNA,
  budDNA,
  feedingRole,
  express,
  variantKey,
} from "./genetics.js";
import {
  bodyRadius,
  territoryRadius,
  freePosition,
  movementBlockers,
} from "./space.js";
import { habitat, elevation } from "./terrain.js";
export const DT = 1 / 30;
const FAMILY_NAMES = [
  "Aster",
  "Cinder",
  "Moss",
  "Slate",
  "Tidal",
  "Fern",
  "Ochre",
  "Quartz",
  "Ember",
  "Onyx",
  "Flint",
  "Copper",
];
export class PlanetWorld {
  constructor(
    seed = 90210,
    neural = DEFAULT_NEURAL,
    founders = 2,
    environment = {},
  ) {
    validateSeed(seed);
    numberInRange(founders, "ancestral copies", 1, 80, true);
    this.neural = Object.freeze(validateNeuralConfig(neural));
    this.parameters = parameterCount(this.neural);
    this.modelVersion = "planet-v3";
    this.reproductionMode = "asexual";
    this.collisions = 0;
    this.conflicts = 0;
    this.seed = seed;
    this.brainSeed = (seed + 12345) >>> 0;
    this.nextId = 1;
    this.tick = 0;
    this.time = 0;
    this.accumulator = 0;
    this.initialFounders = founders;
    this.renewal = 60;
    this.mutation = 12;
    this.environment = {
      oxygen: 21,
      temperature: 24,
      seaLevel: 38,
      ruggedness: 55,
      fertility: 70,
    };
    this.environmentVersion = 0;
    this.interventions = [];
    for (const [key, value] of Object.entries(environment))
      this.setEnvironment(key, value);
    this.organisms = [];
    this.food = [];
    this.carcasses = [];
    this.eggs = [];
    this.pedigree = new Map();
    this.families = new Map();
    this.variants = new Set();
    this.newVariants = 0;
    this.births = 0;
    this.conceptions = 0;
    this.kills = 0;
    this.deaths = {
      conflict: 0,
      predation: 0,
      starvation: 0,
      age: 0,
      oxygen: 0,
      temperature: 0,
      water: 0,
    };
    this.roleHistory = [];
    this.history = [];
    this.events = [];
    this.limitReached = false;
    this.blockedBirths = 0;
    this.ledger = { initial: 0, input: 0, heat: 0 };
    this.homes = Array.from({ length: 8 }, () => this.landPoint());
    this.ancestorDNA = founderDNA();
    this.ancestorBrains = createBrains(
      this.neural,
      () => this.brainRandom(),
      undefined,
      this.mutation,
    );
    for (let i = 0; i < founders; i++) {
      const traits = express(this.ancestorDNA);
      const n = freePosition(
        this.landNear(this.homes[0], 100),
        bodyRadius({ traits }),
        this.organisms,
        this.environment,
        traits.swim,
      );
      if (!n) throw new Error("No free founder position in this habitat");
      this.organisms.push(this.makeFounder("prey", i, i % 2 ? "M" : "F", n));
    }
    for (let i = 0; i < 800; i++)
      this.addFood(false, i < 560 ? this.homes[i % 8] : null);
    this.objects = Array.from({ length: 240 }, (_, i) => ({
      id: i,
      n: this.landPoint(),
      type: i % 4 === 0 ? "rock" : "tree",
      scale: 0.7 + this.random() * 1.2,
    }));
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
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  brainRandom() {
    this.brainSeed = (1664525 * this.brainSeed + 1013904223) >>> 0;
    return this.brainSeed / 4294967296;
  }
  setEnvironment(key, value) {
    const limits = {
      oxygen: [0, 60],
      temperature: [-10, 50],
      seaLevel: [5, 75],
      ruggedness: [0, 100],
      fertility: [0, 100],
    };
    if (!limits[key]) throw new Error("Unknown environmental variable");
    numberInRange(value, key, ...limits[key]);
    this.environment[key] = value;
    this.environmentVersion++;
    this.interventions.push({ tick: this.tick, key, value });
  }
  landPoint() {
    for (let i = 0; i < 300; i++) {
      const n = randomPoint(() => this.random());
      if (!habitat(n, this.environment).water) return n;
    }
    return [0, 0, 1];
  }
  landNear(center, radius) {
    for (let i = 0; i < 30; i++) {
      const n = offset(
        center,
        this.random() * Math.PI * 2,
        this.random() * radius,
      );
      if (!habitat(n, this.environment).water) return n;
    }
    return [...center];
  }
  family(id, role) {
    if (!this.families.has(id))
      this.families.set(id, {
        id,
        name: FAMILY_NAMES[id] ?? `Family ${id + 1}`,
        role,
        births: 0,
      });
    return this.families.get(id);
  }
  baseOrganism(
    role,
    dna,
    n,
    familyId,
    sex,
    parents = [],
    generation = 1,
    brains = null,
  ) {
    const traits = express(dna),
      id = this.nextId++,
      hunter = role === "predator";
    const [east, north] = basis(n),
      angle = this.random() * Math.PI * 2;
    const o = {
      id,
      role,
      dna,
      traits,
      n: [...n],
      territoryCenter: [...n],
      defenseAfter: 0,
      heading: add(scale(east, Math.cos(angle)), scale(north, Math.sin(angle))),
      familyId,
      ancestry: [familyId],
      sex,
      parents,
      generation,
      age: parents.length ? 0 : 20,
      energy: parents.length ? 55 : hunter ? 140 : 95,
      capacity: hunter ? 230 : 180,
      tissueEnergy: 32,
      health: 100,
      maxHealth: 100,
      cooldownUntil: 0,
      mateAfter: 0,
      dead: false,
      action: "exploring",
      control: [0, 1, hunter ? 1 : -1, 1],
      traces: [],
      brains:
        brains ??
        createBrains(
          this.neural,
          () => this.brainRandom(),
          undefined,
          this.mutation,
        ),
      inputLabels: INPUTS,
      outputLabels: OUTPUTS,
      offspring: [],
      variant: variantKey(role, traits),
      mutations: [],
    };
    this.family(familyId, role);
    this.variants.add(o.variant);
    this.pedigree.set(id, {
      id,
      role,
      sex,
      familyId,
      parents: [...parents],
      offspring: [],
      generation,
      birthTick: parents.length ? this.tick : -600,
      deathTick: null,
      cause: null,
      dna: structuredClone(dna),
      variant: o.variant,
    });
    return o;
  }
  makeFounder(role, familyId, sex, n) {
    return this.baseOrganism(
      role,
      structuredClone(this.ancestorDNA),
      n,
      familyId,
      sex,
      [],
      1,
      structuredClone(this.ancestorBrains),
    );
  }
  addFood(external = true, home = null) {
    if (this.food.length >= 2000) return;
    const n = home ? this.landNear(home, 140) : this.landPoint();
    if (habitat(n, this.environment).water) return;
    this.food.push({ id: this.nextId++, n, energy: 24 });
    if (external) this.ledger.input += 24;
  }
  nearest(o, items, range = o.traits.sense) {
    let best = null,
      d = 2 - 2 * Math.cos(range / RADIUS);
    for (const x of items) {
      if (x.dead || x.energy <= 0 || x.id === o.id) continue;
      const dist = 2 - 2 * dot(o.n, x.n);
      if (dist < d) {
        best = x;
        d = dist;
      }
    }
    return best;
  }
  mature(o) {
    return o.age >= 18;
  }
  ready(o) {
    return (
      !o.dead &&
      this.mature(o) &&
      o.energy >= (o.role === "predator" ? 150 : 112) &&
      o.health > 45 &&
      this.tick >= o.mateAfter
    );
  }
  compatible(a, b) {
    return (
      a.id !== b.id &&
      a.role === b.role &&
      a.sex !== b.sex &&
      !a.parents.includes(b.id) &&
      !b.parents.includes(a.id) &&
      !a.parents.some((id) => b.parents.includes(id))
    );
  }
  oxygenStress(o) {
    return Math.max(
      0,
      Math.abs(this.environment.oxygen - o.traits.oxygen) - o.traits.tolerance,
    );
  }
  sense(o) {
    const hunter = o.role === "predator",
      prey = this.organisms.filter((x) => x.role === "prey" && !x.dead),
      hunters = this.organisms.filter((x) => x.role === "predator" && !x.dead),
      edible = hunter
        ? [...prey, ...this.carcasses.filter((x) => x.role === "prey")]
        : this.food;
    const food = this.nearest(o, edible),
      threat = hunter
        ? null
        : this.nearest(
            o,
            hunters,
            o.traits.sense * (1 - habitat(o.n, this.environment).cover * 0.35),
          ),
      mate =
        this.reproductionMode !== "asexual" && this.ready(o)
          ? this.nearest(
              o,
              this.organisms.filter(
                (x) => this.ready(x) && this.compatible(o, x),
              ),
            )
          : null;
    const right = cross(o.n, o.heading),
      local = (x) => {
        if (!x) return [0, 0, 0];
        const dir = tangent(o.n, x.n),
          amount = Math.min(1, distance(o.n, x.n) / o.traits.sense);
        return [dot(dir, o.heading) * amount, dot(dir, right) * amount, 1];
      };
    return {
      food,
      threat,
      mate,
      inputs: [
        ...local(food),
        ...local(threat),
        ...local(mate),
        (o.energy / o.capacity) * 2 - 1,
        o.health / 50 - 1,
        clamp(this.oxygenStress(o) / 20, 0, 1),
        habitat(o.n, this.environment).height * 2 - 1,
        Math.min(1, o.age / 180),
      ],
    };
  }
  control(o, s) {
    if (o.brains.length) {
      const result = decide(o.brains, s.inputs);
      o.control = result.output;
      o.traces = result.traces;
      o.action = "neural behavior";
      return;
    }
    let target = s.threat ?? s.mate ?? s.food,
      dir;
    if (target) {
      dir = tangent(o.n, target.n);
      if (s.threat) {
        dir = scale(dir, -1);
        o.action = "fleeing";
      } else if (s.mate) o.action = "seeking mate";
      else o.action = o.role === "predator" ? "hunting" : "foraging";
    } else {
      const a = (this.random() - 0.5) * 1.4;
      dir = add(
        scale(o.heading, Math.cos(a)),
        scale(cross(o.n, o.heading), Math.sin(a)),
      );
      o.action = "exploring";
    }
    const angle = Math.atan2(
      dot(dir, cross(o.n, o.heading)),
      dot(dir, o.heading),
    );
    o.control = [
      clamp(angle / 0.6, -1, 1),
      1,
      o.role === "predator" ? 1 : -1,
      1,
    ];
  }
  spend(o, amount) {
    const v = Math.min(o.energy, Math.max(0, amount));
    o.energy -= v;
    this.ledger.heat += v;
  }
  die(o, cause) {
    if (o.dead) return;
    o.dead = true;
    this.deaths[cause]++;
    if (cause === "predation") this.kills++;
    this.carcasses.push({
      id: this.nextId++,
      n: [...o.n],
      role: o.role,
      energy: o.energy + o.tissueEnergy,
    });
    o.energy = 0;
    o.tissueEnergy = 0;
    const record = this.pedigree.get(o.id);
    if (record) {
      record.deathTick = this.tick;
      record.cause = cause;
    }
  }
  combat() {
    const damage = new Map();
    for (const a of this.organisms) {
      if (
        a.dead ||
        a.role !== "predator" ||
        a.age < 18 ||
        a.control[2] <= 0 ||
        a.cooldownUntil > this.tick ||
        a.energy < 2
      )
        continue;
      const prey = this.nearest(
        a,
        this.organisms.filter((b) => b.role === "prey" && !b.dead),
        bodyRadius(a) + 50,
      );
      if (!prey || distance(a.n, prey.n) > bodyRadius(a) + bodyRadius(prey) + 3)
        continue;
      this.spend(a, 2);
      a.cooldownUntil = this.tick + 30;
      damage.set(
        prey.id,
        (damage.get(prey.id) || 0) + (24 - prey.traits.armor * 14),
      );
      a.action = "attacking";
      this.events.push({
        type: "attack",
        a: [...a.n],
        b: [...prey.n],
        until: this.tick + 8,
      });
    }
    for (const o of this.organisms) {
      o.health -= damage.get(o.id) || 0;
      if (!o.dead && o.health <= 0) this.die(o, "predation");
    }
  }
  resolveConflicts(contacts) {
    const damage = new Map();
    for (const pair of contacts)
      for (const [defender, intruder] of [pair, [...pair].reverse()]) {
        if (
          defender.dead ||
          intruder.dead ||
          !this.mature(defender) ||
          defender.defenseAfter > this.tick ||
          defender.energy < 2 ||
          distance(defender.territoryCenter, intruder.n) >
            territoryRadius(defender) + bodyRadius(intruder)
        )
          continue;
        // Do not interpret an immature direct offspring's proximity as an attack.
        if (intruder.age < 18 && intruder.parents.includes(defender.id))
          continue;
        defender.defenseAfter = this.tick + 30;
        if (this.random() >= defender.traits.aggression) continue;
        this.spend(defender, 2);
        damage.set(
          intruder.id,
          (damage.get(intruder.id) || 0) +
            10 * (1 - intruder.traits.armor * 0.6),
        );
        defender.action = "defending territory";
        this.conflicts++;
        this.events.push({
          type: "conflict",
          a: [...defender.n],
          b: [...intruder.n],
          until: this.tick + 15,
        });
      }
    for (const o of this.organisms) {
      if (o.dead) continue;
      o.health -= damage.get(o.id) || 0;
      if (o.health <= 0) this.die(o, "conflict");
      else if (o.energy <= 0) this.die(o, "starvation");
    }
  }
  feed() {
    const priority = (o) =>
      Math.imul(o.id ^ Math.imul(this.tick, 2654435761), 2246822519) >>> 0;
    for (const o of this.organisms
      .filter((x) => !x.dead)
      .sort((a, b) => priority(a) - priority(b) || a.id - b.id)) {
      const f = this.nearest(
        o,
        o.role === "prey"
          ? this.food
          : this.carcasses.filter((c) => c.role === "prey"),
        o.traits.size + 9,
      );
      if (!f) continue;
      const amount = Math.min(
        f.energy,
        o.capacity - o.energy,
        o.role === "prey" ? 18 : 36 * DT,
      );
      f.energy -= amount;
      o.energy += amount;
      if (amount > 0) o.action = "eating";
    }
    this.food = this.food.filter((f) => f.energy > 1e-9);
    this.carcasses = this.carcasses.filter((f) => f.energy > 1e-9);
  }
  mate() {
    const used = new Set();
    for (const a of this.organisms) {
      if (!this.ready(a) || a.control[3] <= 0 || used.has(a.id)) continue;
      const b =
        this.reproductionMode === "asexual"
          ? null
          : this.nearest(
              a,
              this.organisms.filter(
                (b) =>
                  this.ready(b) &&
                  b.control[3] > 0 &&
                  !used.has(b.id) &&
                  this.compatible(a, b),
              ),
              bodyRadius(a) + 65,
            );

      if (
        this.organisms.length + this.eggs.length >= 400 ||
        this.pedigree.size + this.eggs.length >= 5000
      ) {
        this.blockedBirths++;
        this.limitReached = true;
        continue;
      }
      used.add(a.id);
      if (b) used.add(b.id);
      a.energy -= b ? 45 : 90;
      if (b) b.energy -= 45;
      this.ledger.heat += 3;
      a.mateAfter = this.tick + 900;
      a.action = b ? "mating" : "budding";
      if (b) {
        b.mateAfter = a.mateAfter;
        b.action = "mating";
      }
      const inherited = b
          ? inheritDNA(a.dna, b.dna, () => this.random(), this.mutation)
          : budDNA(a.dna, () => this.random(), this.mutation),
        mother = !b || a.sex === "F" ? a : b;
      // Inherit whole homologous modules from either parent rather than splicing unrelated hidden units.
      const modules = a.brains.map((net, i) =>
        !b || this.brainRandom() < 0.5 ? net : b.brains[i],
      );
      const egg = {
        id: this.nextId++,
        n: [...mother.n],
        role: feedingRole(inherited.dna),
        parents: b ? [a.id, b.id] : [a.id],
        familyId: mother.familyId,
        ancestry: [...new Set([...a.ancestry, ...(b?.ancestry ?? [])])],
        generation: Math.max(a.generation, b?.generation ?? a.generation) + 1,
        dna: inherited.dna,
        mutations: inherited.mutations,
        energy: 87,
        hatchAt: this.tick + 180,
        brains: createBrains(
          this.neural,
          () => this.brainRandom(),
          modules,
          this.mutation,
        ),
      };
      this.eggs.push(egg);
      this.conceptions++;
      this.events.push({
        type: b ? "mate" : "bud",
        a: [...a.n],
        b: [...(b?.n ?? a.n)],
        until: this.tick + 30,
      });
    }
  }
  hatch() {
    const keep = [];
    for (const e of this.eggs) {
      if (e.hatchAt > this.tick) {
        keep.push(e);
        continue;
      }
      const traits = express(e.dna);
      const n = freePosition(
        e.n,
        bodyRadius({ traits }),
        this.organisms,
        this.environment,
        traits.swim,
      );
      if (!n) {
        keep.push(e);
        continue;
      }
      const variant = variantKey(e.role, traits),
        novel = !this.variants.has(variant);
      const child = this.baseOrganism(
        e.role,
        e.dna,
        n,
        e.familyId,
        this.random() < 0.5 ? "F" : "M",
        e.parents,
        e.generation,
        e.brains,
      );
      child.ancestry = e.ancestry;
      child.mutations = e.mutations;
      this.organisms.push(child);
      for (const id of e.parents) {
        const parent = this.pedigree.get(id);
        if (parent) parent.offspring.push(child.id);
        const alive = this.organisms.find((o) => o.id === id);
        if (alive) alive.offspring.push(child.id);
      }
      for (const familyId of child.ancestry)
        this.family(familyId, child.role).births++;
      this.pedigree.get(child.id).ancestry = [...child.ancestry];
      if (novel) this.newVariants++;
      this.births++;
    }
    this.eggs = keep;
  }
  stepTick() {
    this.tick++;
    this.time = this.tick * DT;
    const expected =
      this.renewal * 0.35 * (this.environment.fertility / 70) * DT;
    for (let i = 0; i < Math.floor(expected); i++)
      this.addFood(
        true,
        this.random() < 0.8 ? this.homes[Math.floor(this.random() * 8)] : null,
      );
    if (this.random() < expected % 1)
      this.addFood(
        true,
        this.random() < 0.8 ? this.homes[Math.floor(this.random() * 8)] : null,
      );
    for (const c of this.carcasses) {
      const decay = c.energy * 0.005 * DT;
      c.energy -= decay;
      this.ledger.heat += decay;
    }
    for (const o of this.organisms) {
      o.age += DT;
      const env = habitat(o.n, this.environment),
        stress = this.oxygenStress(o),
        tempStress = Math.max(
          0,
          Math.abs(env.temperature - o.traits.temperature) - 14,
        ),
        waterStress = env.water ? Math.max(0, 0.65 - o.traits.swim) * 3 : 0;
      const causes = [
        ["oxygen", stress * 0.7],
        ["temperature", tempStress * 0.3],
        ["water", waterStress],
      ];
      const cause = causes.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
      const damage = stress * 0.7 + tempStress * 0.3 + waterStress;
      o.health -= damage * DT;
      if (damage === 0 && o.energy > 40)
        o.health = Math.min(100, o.health + 0.12 * DT);
      if (o.health <= 0) this.die(o, cause);
      else if (o.energy <= 0) this.die(o, "starvation");
      else if (o.age >= (o.role === "prey" ? 300 : 360)) this.die(o, "age");
    }
    if ((this.tick - 1) % 6 === 0) {
      const senses = this.organisms
        .filter((o) => !o.dead)
        .map((o) => [o, this.sense(o)]);
      for (const [o, s] of senses) this.control(o, s);
    }
    const contacts = new Map();
    // Rotate priority each tick so low IDs do not permanently own movement priority.
    const movementOrder = this.organisms
      .slice()
      .sort((a, b) => ((a.id + this.tick) % 401) - ((b.id + this.tick) % 401));
    for (const o of movementOrder) {
      if (o.dead) continue;
      const turn = o.control[0] * 3 * DT;
      o.heading = norm(
        add(
          scale(o.heading, Math.cos(turn)),
          scale(cross(o.n, o.heading), Math.sin(turn)),
        ),
      );
      const env = habitat(o.n, this.environment),
        juvenile = o.age < 18 ? 0.65 : 1,
        throttle = (o.control[1] + 1) / 2,
        velocity =
          o.traits.speed *
          juvenile *
          throttle *
          env.speed *
          (env.water ? 0.5 + o.traits.swim : 1);
      const candidate = walk(o.n, o.heading, velocity * DT);
      const blockers = movementBlockers(o, candidate, this.organisms);
      if (
        !env.water &&
        habitat(candidate, this.environment).water &&
        o.traits.swim < 0.65
      ) {
        o.heading = norm(cross(o.n, o.heading));
        o.action = "avoiding water";
      } else if (blockers.length) {
        this.collisions++;
        for (const other of blockers) {
          const pair = [o, other].sort((a, b) => a.id - b.id);
          contacts.set(pair.map((x) => x.id).join(":"), pair);
        }
        o.heading = norm(cross(o.n, o.heading));
        o.action = "yielding space";
      } else {
        o.n = candidate;
        o.heading = tangent(o.n, o.heading);
      }
      this.spend(
        o,
        DT *
          (0.12 +
            velocity * 0.004 +
            o.traits.size * 0.018 +
            o.traits.armor * 0.06 +
            o.traits.tolerance * 0.005 +
            this.parameters * 0.000025),
      );
      if (o.energy <= 0) this.die(o, "starvation");
    }
    this.resolveConflicts([...contacts.values()]);
    this.combat();
    this.feed();
    this.mate();
    this.organisms = this.organisms.filter((o) => !o.dead);
    this.hatch();
    this.events = this.events.filter((e) => e.until >= this.tick);
    if (this.events.length > 100)
      this.events.splice(0, this.events.length - 100);
    if (this.tick % 30 === 0) this.sample();
  }
  step(dt) {
    numberInRange(dt, "dt", Number.MIN_VALUE, 1);
    this.accumulator += dt;
    while (this.accumulator + 1e-12 >= DT) {
      this.stepTick();
      this.accumulator = Math.max(0, this.accumulator - DT);
    }
  }
  sample() {
    const prey = this.organisms.filter((o) => o.role === "prey").length;
    this.roleHistory.push({
      time: this.time,
      prey,
      predators: this.organisms.length - prey,
      births: this.births,
      oxygen: this.environment.oxygen,
      meanOxygen: this.organisms.length
        ? this.organisms.reduce((s, o) => s + o.traits.oxygen, 0) /
          this.organisms.length
        : null,
    });
    this.history.push(this.organisms.length);
    if (this.history.length > 180) {
      this.roleHistory.shift();
      this.history.shift();
    }
  }
  storedEnergy() {
    return (
      this.organisms.reduce(
        (s, o) => s + (o.dead ? 0 : o.energy + o.tissueEnergy),
        0,
      ) +
      [...this.food, ...this.carcasses, ...this.eggs].reduce(
        (s, x) => s + x.energy,
        0,
      )
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
