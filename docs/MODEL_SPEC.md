# Legacy-v1 model specification

This describes the preserved P00 model. The default 2D predator route is documented in [PREDATOR_V2_MODEL.md](PREDATOR_V2_MODEL.md); the retained 3D planet route at `/planet.html` is documented in [PLANET_MODEL.md](PLANET_MODEL.md). P00 added validation, readable formatting, and reproducible characterization fixtures without changing legacy ecological behavior.

## Purpose and interpretation

An abstract 2D artificial-life experiment for observing food competition, energy expenditure, reproduction, inherited trait mutation, and inherited neural weights. It is not calibrated to an actual organism or physical time/length scale. More neurons do not imply intelligence or better survival.

The current world contains organisms and point food particles. There are no predators, injuries, carcasses, obstacles, nutrient cycles, controller memory, sexual reproduction, or lifetime learning.

## State and scale

World coordinates span x = 0…1000 and y = 0…700 in abstract length units. Time is measured in simulated seconds. Energy, size, and sensing distance have artificial units. The renderer currently stretches coordinates independently to the available canvas width and height.

`Ecosystem` state:

- `neural`: copied/frozen count/depth/width configuration shared by this run.
- `parameters`: total neural weight and bias count per organism.
- `initialSeed`: immutable-in-intent record of the constructor seed (metadata introduced in P00).
- `seed`, `brainSeed`: evolving unsigned 32-bit RNG states.
- `time`, `nextId`, `births`: elapsed simulated time, next organism ID, cumulative births.
- `organisms`, `food`: live stores in iteration order.
- `renewal`, `mutation`: validated live rates, stored internally in `_renewal`/`_mutation`.
- `history`, `lastSample`: up to 120 scalar population samples and last sampled integer second.

Each organism stores its ID, position, angle, energy, age, generation, speed, sensing radius, body size, display hue, brain arrays, next decision time, current turn/throttle outputs, and latest activation traces. IDs increase monotonically. No parent IDs or death records are stored. Food stores only x/y coordinates and has no persistent ID, quantity, or finite energy balance.

## Initialization

Default seed: **90210**. Initial brain RNG seed before brain generation: **102555**, calculated as `(seed + 12345) >>> 0`.

Create 64 organisms, then 230 food particles. Each founder starts at a seeded random location/orientation, age 0, generation 1, energy in `[65,115)`, speed `[18,40)`, sensing radius `[60,110)`, body size `[4,6)`, and hue `[85,160)`. Body dimensions are not biological mass. Hue only changes display color.

The rule baseline has zero networks. The UI can restart with 1–4 dense networks; their weights consume the separate brain RNG. Founder positions, traits, and food locations therefore start identically across valid architectures with the same seed.

The local JSON preset `dist/presets/legacy-v1.json` exactly describes the default setup. Load a parsed preset using `Ecosystem.fromConfig(config)`. This is an engine API; there is not yet a preset picker/import UI. Schema v1 only supports the existing world size and founder/resource counts; unsupported alternatives are rejected rather than silently ignored.

## Random numbers

Both streams use the same linear congruential update:

```text
state = (1664525 × state + 1013904223) >>> 0
random = state / 4294967296
```

The world stream supplies positions, founder traits, wandering, trait mutations, and resource renewal. The brain stream supplies weight initialization and weight mutations. Order and number of calls matter. Neither stream is a cryptographic generator.

## Scheduling and process order

`step(dt)` accepts a finite number with `0 < dt <= 1` seconds. This upper input guard was added in P00 to reject oversized calls; the application normally uses steps no larger than 1/30 second. P00 has **not** introduced a fixed-tick engine.

The browser computes elapsed animation time, caps a frame delta at 0.06 seconds, multiplies by requested speed (1×, 3×, or 8×), and subdivides it into pieces no larger than 1/30 second, including a possible shorter remainder. Paused frames still render. Reduced-motion preference starts playback paused.

A step performs:

1. Advance world time by dt.
2. Let expected food additions be `renewal × 0.18 × dt`. Add the integer part, then sample a possible fractional addition. There is one fractional RNG draw even when renewal is zero. `addFood()` does nothing at the 650-particle cap.
3. For each organism, in array order: increment age; scan all current food; select the nearest particle strictly within sensing radius; compute/retain control; move and clamp to boundaries; deduct expenditure; possibly eat; possibly reproduce.
4. Remove organisms whose energy is <= 0 or age is >= 160. Append queued offspring. Newborns first act on the following call.
5. If the integer part of time differs from `lastSample`, append the current population and retain the latest 120 samples.

This ordering includes known defects characterized below. It is preserved in P00 to establish an exact starting point.

## Movement and sensory observations

The rule controller instantly faces the nearest detected food. With no target it perturbs its angle by `(random - 0.5) × 2 × sqrt(dt)`. Its throttle is 1.

Neural controllers evaluate when `time >= decisionAt`; afterward `decisionAt = time + 0.2`. This is approximately 5 Hz, with cadence tied to actual step partitioning. Their turn rate is `output[0] × 3` radians per simulated second. Throttle is `0.15 + 0.85 × (output[1] + 1) / 2`, so it cannot intentionally stop completely.

Position advances by heading × speed × throttle × dt, independently clamped to world bounds. If either coordinate equals its boundary, angle increases by pi. There is no acceleration, inertia, drag, body collision, or occlusion.

Neural inputs, in immutable semantic order for this model:

1. Food ahead: target displacement divided by sensing radius and projected onto heading.
2. Food lateral: the corresponding local lateral projection.
3. Food detected: 1 if a target was selected, otherwise 0.
4. Energy: `energy / 85 - 1`, measured before this step's expenditure/feeding.
5. Wall ahead: projection of an inward boundary signal onto heading.
6. Wall lateral: corresponding lateral projection.
7. Oscillator: `sin(age × 2)` after age advancement.

With no food detection, the first two inputs are zero. Wall influence starts within 60 units of a wall, linearly rising toward 1 at that wall. At a corner its projected magnitude can exceed 1: this model does not clamp observations to a unit interval. Seven finite numeric values are mandatory at the neural API boundary. Output order is turn, then throttle.

## Neural networks

Architecture is `[7, ...hiddenLayers, 2]`, with 1–3 hidden layers of uniform width 2–12. Each neuron has a bias. Every non-input layer uses tanh. Initial weights and biases are `(2 × random - 1) × sqrt(2 / previousWidth)`.

Each network gets identical inputs. The final two outputs are averaged equally across networks. Full traces for all organisms are currently allocated and retained until the next evaluation. A zero-network `decide` call returns empty traces and two zeros; the engine instead selects its separate rule controller when count is zero.

Parameter count is `count × sum(nextWidth × (previousWidth + 1))`. One 6-wide hidden layer has 62 parameters. Four networks with three 12-wide hidden layers have 1,736 parameters. These are numerical controllers, not simulated biological neurons.

No training occurs during life. Offspring copy parent weights, then each weight/bias independently has `mutation / 100` probability of adding `(random - 0.5) × 0.8`, clamped to [-4,4]. Parent shape must match offspring architecture; mixed topologies are not supported. Parent arrays are not aliased by offspring.

## Energy, feeding, reproduction, mortality

Energy cost per simulated second:

```text
0.7 + speed × throttle × 0.022
    + sense × 0.004 + size × 0.07 + parameters × 0.00015
```

Food consumption checks the target's **pre-movement** squared distance against `(size + 5)^2`. If still present in the shared food array, that particle is removed and 29 energy added, capped at 170. There is no separate stomach, digestion, producer biomass, or accounting for excess energy discarded at the cap.

An organism reproduces when energy > 135, age > 7, and current population plus queued children is < 350. It loses 68 energy; its child receives 65, starts at the same position with random orientation, age 0, generation `parent + 1`, and mutated traits. The 3-energy difference is an implicit loss, not a tracked ledger entry. No explicit tissue investment is modeled.

Trait mutation uses probability `mutation / 100` and additive offset `(random - 0.5) × (max-min) × 0.35`, clamped to the trait's inherited bounds. Each trait draws separately.

The same mutation setting affects trait and weight probability. UI range is 0–60%; the engine supports 0–100% for controlled extremes. Starvation and age removal happen after the full organism loop. Extinct worlds are not reseeded automatically; food renewal can continue in an empty world.

## Observation and user inputs

The interface reports population, maximum living generation, elapsed time, cumulative births, and population history. Inspection shows energy/traits/age and neural activations for a living selection. It does not preserve full dead organism information.

Food renewal and mutation sliders apply immediately without an intervention log. Neural count/depth/width are pending settings until Apply & restart. Restart preserves active architecture and current rates, and resets to seed 90210. Unsaved state is lost on reload. Inspecting or drawing does not consume RNG.

## P00 validation contract

- Constructor seed must be an integer in 0…4294967295. Invalid types, fractions, NaN, and infinities are rejected.
- Neural config must contain exactly count/depth/width with supported integer values. It is copied and frozen. Prior rounding/clamping of invalid config is deliberately replaced by errors.
- Presets require the complete schema, a recognized model/version and rule/neural mode consistent with network count, and the fixed legacy dimensions/counts.
- Renewal accepts finite 0–100; mutation accepts finite 0–100. Rejected setter assignments leave the prior value unchanged.
- Step dt must satisfy its documented bound. Rejected dt leaves world state unchanged.
- Neural evaluation rejects malformed input lengths, nonfinite values, malformed weights, wrong output dimensions, and invalid parent architecture before mutation draws.
- Internally created arrays remain mutable runtime state; arbitrary external mutation of entity state is not a supported validated configuration mechanism.

## Characterization evidence

`tests/fixtures/legacy-v1.json` was generated from the unmodified pre-P00 engine before source formatting/validation. It records Node/V8/platform/architecture, root seed, dt, and three cases at 0, 30, and 1,800 calls of `step(1/30)`.

At 1,800 calls (approximately 60 seconds):

- Zero networks: population 166; food 10; births 129.
- One network `[7,6,2]`: population 194; food 229; births 139.
- Four networks `[7,12,12,12,2]`: population 174; food 167; births 122.

Each sample includes world/brain RNG state, next ID, first living organism traits, and SHA-256 of the complete legacy public state projection. Full neural weights and traces contribute to each digest, even though they are not duplicated in the JSON fixture.

`tests/fixtures/legacy-state.mjs` defines the projection explicitly. It excludes P00 metadata and backing-property names. Do not change this projection just to hide behavior differences. Exact hashes are same-runtime characterization guarantees; platform/runtime differences must be investigated and disclosed, not silently accepted or overwritten.

The older `tests/neural.mjs` smoke scenarios deliberately call `create(parent)` before running and set mutation to zero. They therefore consume RNG and differ from these uninterrupted reference counts. They test different things; neither set should be substituted for the other.

## Known limitations assigned to later phases

- P01: fixed-tick scheduling, logged commands, fair shared-sensor rule/neural baseline.
- P02: aspect-preserving camera, configurable world geometry, spatial indexing/contact mechanics.
- P03/P04: accountable energy, post-movement interactions, contested-food arbitration, predators, cause-of-death records.
- P03/P06: age removal currently follows reproduction, so an age-expired organism can produce a child during its final call. A regression test explicitly names this legacy behavior.
- P03: silent population/resource caps change ecological outcomes; these are not inferred carrying capacities.
- P05: richer observations/actions, trace allocation costs, controller inference optimization.
- P06 onward: real pedigree/development/genome separation.
- P09/P10: checkpoints, portable continuation, replay, repeated experiments and uncertainty.

P00 does not claim energy conservation, biological realism, cross-frame determinism, or learned cognition.
