# Evolution simulator — implementation plan

**Status:** Ready for an implementation agent. This document plans future work; it does not claim the features below already exist.  
**Repository:** `/Users/adriangroening/Desktop/Sandbox 2`  
**Baseline reviewed:** 30 September 2026. Current `npm test` passes.  
**Primary deliverable:** A local, inspectable 2D evolution laboratory that runs inside VS Code's integrated browser.

## 1. Product objective and boundaries

Extend the existing simulator into an artificial ecosystem in which organisms acquire resources, avoid or hunt one another, reproduce with inherited variation, and change over generations under environmental selection. The user must be able to alter neural architecture and ecological conditions, observe the consequences, and reproduce experiments.

Use an abstract aquatic ecosystem as the initial ecological model: spatial primary production, mobile grazers and hunters, detritus, and nutrient recycling. Organisms are artificial lifeforms, not calibrated representations of bacteria, fish, or any named species. Biological plausibility means explicit mechanisms, tradeoffs, local information, and accountable resource transfers. Additional features alone do not establish scientific validity.

### Required user experience

- Stay local and usable inside VS Code. Retain the local server, current preview route, and task entry. Do not publish, upload experiments, or require a cloud service.
- Retain the black scientific interface. Use precise labels, restrained color, labeled axes, readable controls, and no decorative slogans.
- Keep the world and playback controls prominent; put advanced settings in expandable sections.
- Preserve pause, speed, restart, organism inspection, and neural activity inspection.
- Keep independent controls for **network count**, **hidden depth**, **hidden width**, and later **world width/height**. These are different quantities.
- Provide a useful predator–prey experiment early, then add realism in tested increments.
- Allow extinction and failed strategies. Never silently respawn organisms, subsidize predators, or force a pleasing population graph.
- Make interventions, technical limits, initialization choices, and experiment comparability visible.

### Completion levels

1. **Predator release:** deterministic engine, local sensing, explicit feeding and metabolism, predator/prey behavior, neural actions, mortality accounting, and basic inspection (P00–P05).
2. **Evolution laboratory:** inheritance and life history, recycling, environmental variation, save/replay, batch experiments, and performance hardening (P06–P11).
3. **Expanded realism:** sexual reproduction, evolving network structure, communication, disease, toxins, and spatial disturbances, with isolated experiments and ablations (P12–P17).

Implement all phases when executing this complete roadmap, in dependency order. “Optional module” means available but disabled in the default experiment, not an excuse to leave its implementation half finished. Each phase is a separately reviewable change. Stop at a completion level only if the user requests it or a concrete blocker prevents continuation.

### Deliberate exclusions

No 3D engine rewrite, remote ML API, accounts, multiplayer, photorealistic assets, arbitrary real-world biological claims, full computational fluid dynamics, or genomic chemistry. Preserve a renderer-independent engine so future presentation changes remain possible. Backpropagation and reinforcement learning belong to explicit later experimental modes, not an invisible replacement for evolution.

## 2. What exists and what needs correction

### Current files

- `dist/engine.js`: seeded world, food, organism traits, movement, metabolism, asexual births, age/starvation deaths, and a short population history.
- `dist/neural.js`: dense tanh networks; seven inputs and two outputs; inherited weights; equal averaging of network outputs.
- `dist/app.js`: animation scheduling, canvas rendering, controls, graph, restart, and inspection.
- `dist/brain-view.js`: selected network diagram.
- `dist/index.html`, `dist/style.css`: black interface and settings.
- `tests/neural.mjs`: inheritance, mutation, finite-state, reproducibility, and basic sensor-response checks.
- `.vscode/tasks.json`, `package.json`: local server and tests. There are no required runtime npm dependencies.

### Current model

A world of 1000 × 700 simulation units starts with 64 organisms and 230 food particles. Organisms have speed, size, sensing radius, and display hue. Food produces a fixed energy increment; offspring receive a fixed energy endowment. Population and food are capped at 350 and 650. Neural settings permit 0–4 networks, 1–3 hidden layers, and 2–12 neurons per hidden layer. Decisions are approximately 5 Hz. All organisms share the same architecture within a run, but have different weights.

### Prioritized technical and model issues

1. The browser frame loop splits elapsed time into steps **up to** 1/30 second, including smaller remainder steps. It is not a fixed-tick accumulator. Random draws, births, and decisions can therefore depend on frame timing.
2. Organisms scan the full food array every step. Population and richer sensors will make this expensive.
3. Feeding uses a distance measured before movement and mutates the shared food array sequentially. Array order can decide who eats.
4. Rendering stretches the 1000 × 700 world independently in x/y, changing its visual geometry. Bounds and wall sensors also hard-code these dimensions.
5. Rule-based organisms get instantaneous, perfect nearest-food steering; neural organisms have bounded turning and a slower decision cycle. This is a demonstration baseline, not an isolated neural-capacity comparison.
6. Brain traces are allocated for every decision for every organism, even when none is inspected.
7. Deaths disappear without cause records, biomass, carcasses, or resource accounting. A population cap suppresses births and thereby changes selection.
8. `generation` displays the maximum among living organisms. There is no pedigree, cohort survival, or reliable species concept.
9. Energy and hue are insufficient to model injury, digestion, predation, developmental costs, or reproductive tradeoffs.
10. There are no checkpoints, experiment manifests, batch replicates, input validation tests, or guarantees about browser/worker parity.
11. Existing finite-state tests can pass vacuously if every organism dies. Add fixture-specific assertions and explicit extinction checks.

Keep a `legacy-v1` preset or fixture for comparison. Intentional corrections may change trajectories: record model-version changes instead of preserving known defects in the new model.

## 3. Agent execution contract

For each phase:

1. Inspect the current code and `docs/IMPLEMENTATION_STATUS.md`; do not assume earlier phases are complete merely because this plan exists.
2. Implement a complete vertical slice, including model, controls where applicable, diagnostics, and serialization updates.
3. Add focused tests for the new scientific or engineering failure modes. Do not assert that all ecosystems must survive or that a larger brain must win.
4. Run the relevant tests, then the complete test suite before finishing the phase. Run a benchmark when changing scheduling, neighborhood queries, brain execution, workers, or entity representation.
5. Update `docs/MODEL_SPEC.md`, parameter definitions, checkpoint schema, README, and phase status as applicable.
6. Record validation evidence and known limitations. Keep the default experiment functional throughout.
7. Never silently change parameter units, input-channel order, tick scheduling, or saved-state interpretation. These require model/schema version changes.

Create `docs/IMPLEMENTATION_STATUS.md` at P00 with entries for every phase: `not started`, `in progress`, `verified`, or `blocked`, plus artifacts, test commands, evidence, and next action. Do not mark a feature verified if only its UI exists.

A phase may be decomposed into small commits if repository/version-control tooling is available. Do not initialize a remote, deploy the project, or alter unrelated VS Code preferences.

## 4. Target architecture

Keep browser-native JavaScript modules and the static serving workflow initially. Use JSDoc contracts and schema validation. Introduce a bundler, TypeScript migration, or renderer dependency only with measured benefit and a separately documented migration; none is required for predators.

Treat `dist/` as authored source for now despite its name. Move code incrementally, retaining compatibility exports from `dist/engine.js` and `dist/neural.js` until imports and tests have migrated.

```text
 dist/
   index.html                 existing local entrypoint
   style.css                  scientific dark theme
   app.js                     UI composition; no ecological rules
   engine.js                  compatibility facade
   neural.js                  compatibility facade
   sim/
     config.js                defaults, units, validation, presets
     world.js                 state creation, fixed-tick orchestration
     clock.js                 accumulator and integer tick scheduling
     random.js                versioned seeded RNG streams
     commands.js              tick-stamped interventions
     spatial-grid.js          local queries and contact candidates
     entities.js              stable IDs, stores, birth/death queues
     genome.js                inherited genes and phenotype expression
     sensors.js               shared, versioned observation channels
     controllers/
       rule.js                explicit rule baseline
       dense.js               feed-forward execution
       recurrent.js           bounded memory, later phase
       topology.js            graph genome and structural mutation, later
     systems/
       environment.js         light, temperature, oxygen, habitat fields
       resources.js           producers and nutrient/detritus pools
       motion.js              acceleration, drag, collision boundaries
       feeding.js             ingestion and digestion
       combat.js              attacks and injury
       metabolism.js          energy expenditures and stress
       reproduction.js        maturity, investment, embryos/eggs
       mortality.js           idempotent death finalization
       disease.js             optional infection module
       signals.js             optional chemical communication
     metrics.js               counts, rates, cohorts, ledger checks
     checkpoint.js            serialization and migration
     worker.js                worker host using the same world engine
   render/
     world-view.js            camera and entity drawing only
     overlays.js              fields, senses, paths, contacts
     brain-view.js            selected network/state only
   ui/
     settings.js              pending vs active experiment settings
     inspector.js             organism and lineage inspection
     experiments.js           run setup and comparisons
   presets/                   versioned JSON experiment presets
 scripts/
   run-experiment.mjs         DOM-free seeded batch runner
   benchmark.mjs              declared workload and performance report
 tests/
   unit/ integration/ fixtures/
 docs/
   MODEL_SPEC.md PARAMETERS.md IMPLEMENTATION_STATUS.md
```

### Contracts

- `createWorld(config, seed) -> WorldState`
- `stepWorld(world, commandsForTick) -> TickSummary`: exactly one model tick; no wall-clock access.
- `sense(worldSnapshot, organism, spatialIndex) -> ObservationVector`
- `decide(controllerGenome, controllerState, observations) -> { intent, nextState }`
- `express(genome, developmentalState, environment) -> Phenotype`
- `resolveInteractions(world, intents, contacts) -> transfers/events`: validate and commit each transfer once.
- `makeRenderSnapshot(world, selection) -> RenderSnapshot`: no mutation of simulation state or RNG.
- `serialize(world) -> Checkpoint`; `restore(checkpoint) -> WorldState`.
- `runExperiment(manifest) -> summary + timeSeries + checkpointReferences`.

**WorldState:** model/schema version, validated config, integer tick, seeded streams, ID counters, environment fields, organism/resource/egg/carcass stores, pending actions, queued interventions, lineage registry, ledger, and online metrics.

**Genome:** stable gene IDs, morphological/metabolic/sensory/reproductive alleles, controller architecture and inherited weights, optional resistance/signaling alleles, parent references, and origin metadata.

**Phenotype:** derived, costed properties such as radius, mass target, thrust, drag, sensing range/FOV, armor, digestion efficiency, maturity size, and controller cost. Do not copy cached phenotype values back into genes.

**Individual state:** ID, birth tick, parents, lineage, position/velocity/orientation, structural biomass, reserves, gut contents, health, stamina, developmental state, controller memory, cooldowns, and mortality status. Acquired injuries and memory are not inherited by default.

**Intent:** bounded desired thrust/turn, attack, ingestion, mating, and later signaling. An action does not guarantee success: reach, resources, cooldowns, and physiology constrain it.

## 5. Deterministic scheduling and resource rules

### Time and random numbers

Use a 30 Hz fixed model tick initially. Sensor/controller decisions run every six ticks by default, with recorded per-individual phase offsets if staggering is enabled. Environmental grids may update more slowly on integer tick intervals; their rates integrate over their actual elapsed model time.

The browser accumulator requests whole ticks. Playback speed changes ticks requested, not `dt`. Limit the wall-time work budget to keep input responsive. If the requested speed cannot be sustained, show the achieved speed and backlog; do not enlarge model steps or skip biological time while pretending to keep pace. Backgrounding pauses interactive progression by default, with an explicit worker/headless mode for long runs.

Separate RNG streams for initialization, weather/environment, individual mutation, sensing/noise, and interaction arbitration. Derive per-entity streams from root seed and stable IDs where useful. Never use rendering, logging, inspection, or wall-clock timing to consume model randomness. Serialize every active RNG state.

Exact reproducibility is required for the same model version and JS runtime. Test cross-browser numerical agreement separately; do not promise universal bitwise equality for floating-point math. Canonical state hashes must exclude wall-clock durations and UI selection.

### Tick order

Implement and document this ordering; changes require a model-version bump:

1. Apply validated commands scheduled for this tick, ordered by sequence ID.
2. Advance environmental sources, producer growth, transport, and detrital decay due this tick; book all external fluxes.
3. Capture sensing state and compute due observations/controllers. Generate intents without committing interactions.
4. Integrate motion with acceleration/drag; resolve boundary/obstacle contacts; charge only affordable locomotion costs. Finalize lethal contact damage or exhausted organisms according to the declared starvation policy before combat. Rebuild/update the local contact index.
5. Resolve attack eligibility from a common post-movement snapshot, including sufficient reserves/stamina to pay the action cost. Charge eligible attack costs/cooldowns, aggregate damage simultaneously, and finalize lethal combat outcomes once. An individual alive at the start of this stage may complete an eligible simultaneous attack even if it dies in that stage.
6. Resolve ingestion by surviving organisms. Use current positions and finite food/carcass pools. Allocate contested bites with deterministic arbitration. Food cannot be consumed twice.
7. Digest existing/new gut contents, pay maintenance and sensing/brain costs, apply injury/environment stress, and finalize any further deaths. Every decrement and transfer is bounded by what is available.
8. Resolve reproduction for surviving eligible adults; debit investment, create eggs/offspring in a deferred queue, then advance existing developmental stages. No newborn may eat, attack, reproduce, or make a decision until the next tick.
9. Commit entity additions/removals, rebuild needed indexes, append events, sample diagnostics, and check debug invariants.

Make each tick atomic with respect to technical-limit failures: stage changes and RNG states in a next-state transaction, validate capacities, and commit only the complete tick. On rejection, the authoritative world and RNG remain at the prior completed tick; emit an out-of-model limit diagnostic and pause. Use a simple correctness-first transaction initially, then optimize copies or use rollback journals only with parity tests. A checkpoint at a limit must resume the same next tick after a recorded budget change.

Stable hash priorities based on tick and entity/contact IDs avoid persistent first-in-array feeding privileges. Exact tie breaks and simultaneous-damage policy must have fixtures. Display order and storage layout must not decide outcomes.

### Units and ledgers

Start with abstract length units (LU), simulation seconds (s), biomass units (BU), chemical energy units (EU), and limiting-nutrient units (NU). Oxygen uses an explicitly abstract concentration unit until calibrated. Do not label these meters, joules, grams, or physiological concentrations without calibration.

Track energy in reserves, gut contents, producer tissue, structural tissue, eggs, and carcasses/detritus. Tissue may use a declared energy density. Structural energy already included in tissue cannot also appear in reserves or be awarded again as a kill bonus.

For each tick, verify:

```text
storedEnergyAfter - storedEnergyBefore
  = importedChemicalEnergy + capturedLightEnergy - exportedEnergy - dissipatedEnergy

limitingNutrientAfter - limitingNutrientBefore
  = importedNutrient - exportedNutrient
```

A boundary transfer, intervention, initial seed, excretion, failed embryo, deleted test entity, or resource-limit stop needs an explicit treatment. Heat is an energy sink, not recycled food. Nutrient recycling does not create chemical energy. Track a limiting nutrient rather than claiming conservation of all chemical elements or total real-world mass.

Use nonnegative transfer primitives with source/destination/cause. In debug/tests, allow a documented floating tolerance, initially `1e-8 × max(1, initial pool + cumulative external inputs)`, then justify any relaxation. Do not conceal accounting bugs through blanket clamping.

## 6. Phased work packages

Each phase below supplies dependencies, deliverables, and a completion gate. The implementation agent should turn its tasks into checked status entries as they pass.

### P00 — Characterize and document the current model

**Depends on:** none.

**Tasks**

- Format the compressed source without mixing in behavior changes.
- Create the model specification, parameter registry, phase tracker, and `legacy-v1` preset/fixture.
- Record exact initial populations, RNG seeds, architecture, rates, caps, state after known tick sequences, and current test results.
- Add configuration validation for finite values, integer dimensions/counts, known modes, and seed range. Reject malformed values rather than silently creating invalid arrays or NaNs.
- Extend tests to explicitly cover empty populations, boundary positions, zero food renewal, mutation extremes, and expected sensor dimensions.

**Gate:** `npm test` passes; current local preview still launches; baseline fixtures are documented; the next phase can refactor without relying on screenshots or approximate population counts.

### P01 — Deterministic engine and shared controller interface

**Depends on:** P00.

**Tasks**

- Extract world state, clock, commands, and RNG modules. Introduce integer tick scheduling and the contract above.
- Separate rules, controller state, rendering, metrics, and event emission.
- Implement real fixed-step accumulation; replace decision-time floating comparisons with integer deadlines.
- Add replayable commands for live nutrient renewal and mutation changes. Changes take effect at declared ticks.
- Make rule and neural controllers use identical observations and actuator bounds. Keep the old perfect-steering behavior only in the labeled legacy preset.
- Give an entity stable identity through births, removals, sorting, and inspection.

**Gate:** the same initial state and commands produce identical model hashes at tick 18,000 under 30/60/144 Hz render schedules, paused/resumed playback, 1×/3×/8× requested speeds, and headless stepping. Inspecting a brain cannot change the hash. No simulation system imports DOM APIs. A rejected limit-reaching tick leaves the world/RNG unchanged, and save/resume after a declared budget increase matches the unrestricted reference run.

### P02 — Spatial world, contact mechanics, and camera

**Depends on:** P01.

**Tasks**

- Implement a uniform spatial hash/grid for local entity, resource, and contact queries. Query all cells intersecting the search radius; retain exact final distance/FOV checks.
- Replace hard-coded world dimensions. Add width/height controls as restart-required settings, initially 250–4000 LU each with validation.
- Establish versioned resource/organism/contact observation records, including range, local-frame direction, visibility mask, occlusion, and observable size/motion features. Rule controllers use these records; they may not scan hidden world state directly. P04 extends this contract for diet/threat interpretation, and P05 maps it into neural channels.
- Implement configurable reflecting and periodic boundaries. Use minimum-image distance consistently for toroidal sensing, collisions, and drawing near seams.
- Introduce velocity, maximum acceleration/turn rate, drag, finite-radius contact, and optional obstacles. Keep motion simple and measurable; this is not a fluid solver.
- Handle tunneling with swept collision/attack checks or a tested speed-to-step bound.
- Render at a uniform scale with letterboxing, pan/zoom, fit-world, follow-selected, and correct coordinate inversion for clicking. Camera changes are purely visual.
- Decide whether resizing preserves initial density or absolute population through an explicit setup option; show the resulting population/resource totals.

**Gate:** neighborhood queries match a brute-force reference on seeded fixtures; contacts work at edges and corners; no out-of-bounds entities or NaNs; fast organisms cannot pass through a thin obstacle or attack through it. Circles remain circular at different preview sizes.

### P03 — Physiology, finite food, and accountable mortality

**Depends on:** P01–P02.

**Tasks**

- Replace fixed energy awards with finite resource stores, bite size, gut capacity, digestion rate, and assimilation efficiency.
- Separate reserve energy, structural biomass, health, and stamina. Define starvation after reserve exhaustion; later body catabolism must debit tissue explicitly.
- Implement basal, locomotion, sensing, neural, growth, repair, and reproductive expenditure as separate ledger terms. Use published-in-model equations and configurable coefficients.
- Add birth/death events and causes: predation, starvation, senescence, injury, environmental stress, and later infection/toxin. Keep one primary cause plus contributing flags.
- Add carcasses with finite tissue/reserve/gut contents; include transfer to detritus even when no scavengers exist.
- Preserve a simple externally supplied-food preset while adding the accounting needed for closed nutrient experiments.
- Replace silent biological caps with technical-limit behavior: pause before an unrepresentable transaction, report the limit, and mark the run censored. Never suppress selected births without recording it.

**Gate:** isolated feeding, digestion, death, repair, and reproduction-transfer fixtures balance energy; no negative pools or double consumption; dying twice produces one event and one carcass. Starved worlds can go extinct without exceptions or auto-reseeding.

### P04 — Predators, prey, and trophic roles

**Depends on:** P02–P03. **First visible predator milestone.**

**Tasks**

- Add initial grazer and hunter templates. Roles initially define diet/physiology; they are not permanent species IDs.
- Extend the shared observation schema with declared edible/threat classification from observable cues. If the first preset uses perfect role recognition, label that simplification and apply it to both rule and neural controllers; P08 can replace it with noisy recognition.
- Add diet efficiencies for producers, living tissue, and carrion. Add attack strength, armor, bite/reach, handling time, attack cooldown, and pursuit stamina with metabolic/developmental costs.
- Implement a rule-based hunter: search locally, select reachable edible prey, pursue, attack at contact, ingest finite carcass tissue, rest or disengage when depleted.
- Implement a rule-based grazer: forage, detect threats within its sensors, flee with bounded acceleration, use available refuge, recover stamina.
- Define attacks as contact-gated damage rather than instant deletion. Use a simple deterministic equation such as `damage = max(0, attackPower - armor) × attackFraction`, with documented size/stamina modifiers and units. Costs apply even to unsuccessful eligible attacks. Stochastic misses are a later optional mechanism.
- Aggregate simultaneous attacks from the same snapshot. Declare how mutual kills work. Kills create carcasses; do not add energy directly to the hunter.
- Keep cannibalism disabled in the first preset, then expose it as an explicit diet option. It must not bypass kin sensing or transfer rules.
- Add controls for initial grazer/hunter counts, trophic traits, and predator introduction at a scheduled tick. Record introduced energy/nutrients as external inputs.
- Distinguish roles by shape and optional tint. Add population series per role, attack/kill rates, cause-of-death counts, and visible selection details.

**Gate:** controlled fixtures demonstrate pursuit, escape, contact damage, cooldown, finite feeding, and predator starvation without edible resources. Several hunters contesting one prey cannot multiply its energy. A prey animal dying in combat cannot forage or reproduce afterward in that tick. Run a disclosed seed set showing both coexistence and extinction cases; coexistence is not required in every seed.

### P05 — Neural predators and prey with honest architecture controls

**Depends on:** P01, P03–P04.

**Tasks**

- Extend the versioned sensor registry established in P02/P04 and shared by every controller. Initial channels: local resource sectors; visible edible organisms; visible threats; relative velocity; walls/obstacles; energy, health, stamina, gut fullness, age/maturity, cooldown readiness; previous action and a bounded oscillator if enabled.
- Define detection by range, field of view, occlusion, and later noise. Represent missing detections explicitly. Do not supply the true coordinates of unseen entities, future events, genotype, or inaccessible species labels.
- Use fixed sensory sectors or a bounded nearest-K observation scheme so input dimensionality is known. Record channel IDs, normalization ranges, missing-value encoding, and schema version in checkpoints.
- Add outputs for turn, thrust/throttle, attack, feeding, and reproductive willingness. Thresholded actions still obey physiology/cooldowns. Do not force positive movement; organisms may rest.
- Retain count/depth/width controls independently, with per-founder-role configuration or a linked setting. Zero networks selects the shared-sensor rule controller.
- Preserve equal-average ensembles as one named mode. Add evolved-gating ensembles later; do not pretend an average inherently creates specialized brain regions.
- Charge controller cost per expressed structure and evaluation work, with documented model coefficients. Compute it per organism, not from one global architecture.
- Trace only the inspected organism on demand or bounded diagnostic samples. Reuse numeric buffers for normal inference.
- Expose sensor values, output intents, actual constrained actions, saturation, active topology, and energy budget. Make pending/active settings distinct. Changes restart the experiment unless explicitly applied as a recorded intervention to a new cohort.

**Gate:** a hand-set controller fixture turns toward prey or away from a threat as specified; a neural hunter can attack through valid actions; missing targets produce correct masks; no controller receives hidden world state. Changing count/depth/width changes actual parameters and costs. Same-tick rendering and inspection cannot affect decisions. Test 0, 1, and maximum settings for both roles.

### P06 — Heritable physiology, development, and pedigree

**Depends on:** P03–P05.

**Tasks**

- Replace loose copied traits with a versioned genome and phenotype mapping. Separate trait-mutation probability, weight-mutation probability, mutation magnitude, and later structural-mutation probability.
- Add heritable size, thrust, turning, sensory allocation, armor, digestion specialization, metabolism, maturity threshold, reproductive investment, clutch size, and temperature preference. Constrain traits to valid ranges and impose costs/tradeoffs.
- Keep continuous parameters continuous; avoid one unbounded beneficial gene or hue acting as a species identifier.
- Add embryo/egg and juvenile/adult states, development time, growth, maturity, reproduction cooldown, offspring investment, and finite birth placement. Failed births/eggs retain their invested resources in a declared pool.
- Start with asexual inheritance to isolate ecology. Child genomes are deep-independent; brain memory, current health, and acquired experience reset unless a later mode explicitly says otherwise.
- Add parent IDs, founder IDs, birth/death ticks, reproductive output, mutations at birth, and a bounded ancestry index. Retain compact IDs/parent links and life summaries up to a declared archive budget; retain detailed genomes/events only for a bounded sample or pinned individuals. Show “detail not retained” rather than inventing missing history. Before P09, pause at the compact archive limit; after P09, offer local archival/export and indexed retrieval, still subject to a visible budget. Test retention over a large birth count, not just elapsed time.
- Implement optional senescence as an age-dependent hazard or declining repair after maturity. Convert hazards to per-tick probabilities; retain a labeled legacy maximum-age mode.

**Gate:** zero mutation preserves the genome; nonzero mutation leaves the parent unchanged; child investment cannot exceed parent withdrawals; sterile/immature/cooling-down organisms cannot reproduce. Juveniles require time/resources to mature. Tradeoff experiments can distinguish faster-but-costlier bodies from universally stronger bodies. Retained lineage summaries remain inspectable after an ancestor dies; archival limits and missing detailed history are explicit.

### P07 — Primary production, detritus, and nutrient recycling

**Depends on:** P03–P04, P06 for tissue quotas.

**Tasks**

- Add gridded producers with biomass, carrying capacity/space limitation, light response, and a limiting-nutrient requirement.
- Specify a bounded growth law, for example `growth = rate × biomass × (1 - biomass/capacity) × lightFactor × nutrientFactor`, integrated over the subsystem interval and limited by available nutrient/light budget.
- Transfer grazed material into guts; allocate assimilated material, waste, respiratory losses, and tissue growth explicitly.
- Implement carcass decay and mineralization into detrital and dissolved nutrient pools. Start decomposers as an aggregate process; add explicit decomposer organisms only in the expanded food-web preset.
- Implement conservative, nonnegative nutrient diffusion and optional bounded advection. Validate coefficients or substep to respect the chosen solver's stability bound.
- Add patchy resources and resource types with different digestion requirements. Every additional food type needs an ecological distinction, not just another color.
- Retain explicit open-system modes: nutrient inflow/outflow, supplied food, external introductions. Expose these in the experiment manifest and ledger.

**Gate:** closed limiting-nutrient runs conserve that pool within tolerance; darkness stops photosynthetic input; empty nutrient pools constrain growth; scavenging/decay transfers material once. Increasing growth rates cannot produce negative nutrient or overshoot capacity due to a large subsystem step.

### P08 — Heterogeneous habitat and environmental change

**Depends on:** P02, P03, P07.

**Tasks**

- Add deterministic seeded temperature, light, oxygen, current, and refuge/obstacle fields. Start with one field at a time, not all multipliers simultaneously.
- Add day/night light, gradual seasonal temperature changes, local shading, and optional stochastic disturbances from an environment-specific RNG stream.
- Connect temperature to a documented bounded performance curve, maintenance, and digestion. Connect low oxygen to respiration limits and stress; producers/decomposition interact with oxygen through declared simplified fluxes.
- Define refuges physically: entrances/body-size limits, movement/contact restrictions, and occlusion. Do not make prey invulnerable solely because of a hidden tile flag.
- Add costs and benefits for camouflage, visibility, body size, and sensory range. Sensory noise is seeded and has an explicit detection model.
- Add parameterized currents affecting passive motion and resource transport; do not advertise this as hydrodynamic simulation.
- Add editor tools for habitat painting, light/nutrient pulses, barriers, and scheduled warming/hypoxia shocks. Every edit is a validated tick-stamped command and budgeted external transfer where relevant.

**Gate:** identical seeds produce identical fields; organisms respond only to locally available signals; a refuge actually changes geometry; moving boundaries cannot trap entities into invalid positions. Targeted ablations establish that each enabled field changes its intended physiological process without hidden global bonuses.

### P09 — Checkpoints, replay, and local experiment records

**Depends on:** P01 and all implemented stateful systems; implement the checkpoint contract early, finish the user workflow here.

**Tasks**

- Save/load versioned JSON or a documented binary format locally. Include config, root seed and stream states, tick, entities, genomes, recurrent memory if present, fields, development/cooldown queues, commands, ledgers, IDs, and metric accumulator state.
- Separate a lightweight setup preset from a full continuation checkpoint.
- Add checkpoint + command-log replay with seek to recorded checkpoints. Seeking must replay model ticks, not interpolate biological state.
- Add explicit local save slots using IndexedDB and downloadable exports; document that exports provide a portable backup if local storage is cleared.
- Validate imported files before replacing the active world. Handle malformed/oversized files, nonfinite arrays, unknown versions, missing fields, and migration failures without executing imported code.
- Keep old schema readers or explicit migrations with fixtures. Reject unsupported future versions clearly.
- Record interventions and technical-limit censoring; preserve a paused terminal/extinct world for inspection.

**Gate:** saving at tick N, restoring, and running K ticks equals the uninterrupted same-runtime run at N+K, including RNG, pending commands, and controller memory. Failed imports leave the current world intact. A saved experiment can be reopened locally without network access.

### P10 — Repeated experiments and scientific diagnostics

**Depends on:** P05–P09.

**Tasks**

- Implement a headless Node runner importing the same engine. Accept manifest, seed list, duration, sample interval, stop rules, overrides, and output directory.
- Compare rule controllers and neural architectures across independent seeds. Keep founder traits, initial positions/resources, and environmental forcing paired where possible using separate streams. Trajectories will naturally diverge after behavior differs.
- Support sweeps of predator ratio, food supply, sensor quality, brain count/depth/width, mutation, and environmental variability. Bound combinatorial grid size and show planned run count before starting a batch.
- Report trophic population/biomass, births/deaths by cause, energy fluxes, ingestion, attack success, survival/extinction time, reproductive success, age distribution, trait distributions, and effective architecture distributions.
- Record lineage richness separately from genetic clusters and trophic roles. Label cluster diversity accurately; do not call every color or NEAT compatibility group a biological species.
- Add batch cancellation/resume, CSV time series, JSON manifests/summaries, and comparison plots with units and sample counts.
- Use replicate-level statistics, not each time sample as an independent replicate. Show medians/quantiles and declared confidence intervals where computed. Record extinctions and censored runs; never silently drop them.
- Distinguish observational diagnostics from manipulated fitness/reward. Ecosystem selection is differential survival/reproduction, not a global scoreboard.

**Gate:** repeating a manifest gives identical model results in the same runtime; partial batches resume without duplicate seeds; paired founder/environment checks pass; extinction counts include all relevant runs. UI metrics agree with hand-calculated miniature fixtures.

### P11 — Worker execution, scaling, and interface hardening

**Depends on:** P01–P05; finalize checkpoint/experiment integration after P09–P10.

**Tasks**

- Run the engine in a Web Worker; keep rendering/controls on the main thread. Use the same source engine in Node without DOM/worker dependencies in core modules.
- Define a versioned protocol for init, run, pause, command, select, snapshot, checkpoint, and error. Include request IDs, tick acknowledgments, and transfer ownership rules.
- Include a run ID as well as tick/sequence in worker messages, and reject stale snapshots after restart or restore. Provide a same-thread fallback using the same protocol if the embedded browser does not support the worker.
- Publish compact render snapshots at a bounded rate; decouple UI charts from model ticks. Do not transfer full brains for every organism or detach live simulation buffers.
- Use reusable typed arrays/pools where profiling proves value. Avoid premature GPU inference or a full ECS rewrite.
- Add visible requested/achieved speed, entity counts, memory/sample retention, and limit-stop reason in diagnostics.
- Make the settings panel navigable at narrow VS Code pane widths, provide keyboard inspection/next-organism, and ensure charts have labeled axes and text summaries. Keep motion reduction and pause controls.
- Remove external font dependencies if still present so the laboratory works fully offline.

**Gate:** worker and main-thread reference engine agree at checkpoints; pausing is acknowledged without extra unrecorded ticks; UI commands remain responsive during large runs. Meet or document the performance gates in section 9 with measured hardware/runtime details.

### P12 — Sexual reproduction and ecological diversification

**Depends on:** P06, P09–P10.

**Tasks**

- Add an explicit sexual-reproduction mode alongside asexual reproduction. Use mating eligibility, local encounter, maturity, energy investment from both parents, cooldown, and genome compatibility.
- Add recombination with stable gene alignment, dominance/alleles where modeled, heritable mate preference, and optional inbreeding effects with clear coefficients.
- Start neural inheritance by copying one parent's controller or combining aligned fixed-topology genes under a documented strategy. Do not splice arbitrary hidden-neuron positions from unrelated networks and assume functional alignment.
- Add reproductive isolation and genetic-distance diagnostics. Describe inferred groups as clusters until a documented isolation criterion is met.
- Allow diet efficiencies and morphology to evolve continuously into grazing, omnivory, predation, and scavenging. Trophic role becomes an observed/derived classification rather than an immutable label.
- Track pedigree, allele/trait distributions, assortative mating, reproductive barriers, and hybrid outcomes.

**Gate:** two-parent investment balances; incompatible/absent mates prevent reproduction without global mate access; recombination preserves valid genomes; diet changes affect actual assimilation costs. No species is created just because display color changes.

### P13 — Memory, modular controllers, and evolving neural topology

**Depends on:** P05–P06, P09–P11; P12 if combining different sexual-parent topologies.

**Tasks**

- Add bounded recurrent memory with explicit per-individual state and decision scheduling. Memory is reset at birth and included in checkpoints.
- Add fixed-architecture and topology-evolution modes. In evolution mode, sliders set founder architecture and separate hard bounds; they do not overwrite adult brains every frame.
- Represent neurons/connections/modules with stable IDs. Support weight mutation, bounded node/edge addition, edge disabling/removal, module duplication/deletion, and validated graph execution.
- Preserve legal sensor/output channels; distinguish feed-forward edges from one-decision-delayed recurrent edges. Reject instantaneous cycles in feed-forward mode.
- Introduce gated modules as an explicit alternative to equal averaging. Inspect module outputs and gate values; validate numerical stability and cost every evaluated module.
- Add innovation tracking if homologous topology crossover is implemented. Call an algorithm NEAT only if the named method's relevant mechanisms are actually implemented; graph mutation alone is not NEAT.
- If full NEAT selection/speciation is desired, implement it as a separately labeled training mode. Its fitness sharing and managed reproduction change ecological selection and must not silently run in the natural ecosystem.
- Add architecture distributions, mutation histories, complexity/cost measures, and controlled memory tasks. Keep lifetime learning disabled in the default mode.
- Implement lifetime plasticity as a separate subtask after recurrence and topology fixtures pass: inherited initial weights plus bounded runtime weight deltas, an explicit local update rule, bounded learning-rate genes, and named update signals. A minimal Hebbian experiment may use `deltaWeight = learningRate × preActivation × postActivation × modulation - decay × oldDelta`, evaluated at decisions and clamped to declared bounds. Define modulation explicitly; never introduce a hidden survival/kill reward. Include acquired deltas in checkpoints and reset them at birth by default. Offer any inheritance of acquired deltas only as a separately labeled experimental mode. Compare learning disabled/enabled on held-out tasks; do not call recurrence alone learning.

**Gate:** topology operations never corrupt channel mappings; offspring remain executable; disabled edges have no effect; parameter/compute costs reflect expressed graphs. Memory affects a delayed-cue fixture and survives save/load. Structural evolution does not require a preordained increase in network size or fitness. Learning-disabled mode leaves inherited weights unchanged during life; plasticity remains bounded, resumes exactly after restore, and is not inherited in the default mode.

### P14 — Communication and social behavior

**Depends on:** P07–P08, P13 for memory experiments.

**Tasks**

- Add a small bounded set of emitted chemical channels with production cost, decay, diffusion/advection, sensory detection, and no hidden sender identity.
- Add optional kin-recognition cues based on observable signals, with imperfect matching; do not directly expose parent IDs as innate knowledge.
- Permit evolved aggregation, alarm response, cooperative pursuit, mate attraction, and avoidance through local signals/actions. Do not script pack intelligence while calling it emergent.
- Add energy-transfer/food-sharing actions only with contact, donor consent/intent, transfer loss, and exploitation costs.
- Add signal overlays, secretion/response diagnostics, and signal-off/receiver-shuffled ablations.

**Gate:** signaling consumes resources; concentration transport stays stable/nonnegative; signals do not teleport across barriers; disabling signals removes the information channel. Report observed coordinated behavior separately from available mechanisms.

### P15 — Disease, parasites, toxins, and defense

**Depends on:** P03, P06–P10.

**Tasks**

- Begin with one optional infection model: susceptible/exposed/infectious/recovered states or a documented continuous load, local transmission, incubation, recovery, mortality, and acquired immunity duration.
- Use contact/dose-dependent transmission rates converted to tick probabilities, with separate seeded randomness. Add resistance costs and heritable susceptibility; acquired immunity is not automatically inherited.
- Add carcass/environmental transmission only when their finite pathogen loads and persistence rules exist.
- Add optional toxin production, delivery/exposure, decay, resistance, and repair costs. Implement each path as a separate small task after infection works.
- Implement a minimal parasite preset as a separate P15 subtask: entities have infective and host-attached stages, stable host IDs, finite biomass/reserves, attachment range, host compatibility, and finite free-stage lifespan. Attached parasites transfer a bounded amount of host reserves/tissue nutrient into their own budget, pay maintenance, and reproduce only from acquired investment. Host injury and immune clearance follow explicit rates/costs. Offspring enter the infective stage at the host position; attachment requires local contact and seeded transmission, not global assignment. On host death, define survival in the carcass or release into the environment exactly once, preserving stored energy/nutrients. Impose a declared parasite budget and include every stage in checkpoints and diagnostics.
- Integrate disease/toxin deaths, energy costs, history, checkpoint state, and inspection.

**Gate:** zero transmission produces no secondary cases; immunity and incubation follow the configured timing; isolated populations do not infect one another without a modeled transport path; hazards remain comparable at supported subsystem intervals. Turning the module off restores the disease-free model. Parasites cannot attach remotely, draw more resources than a host contains, reproduce unfunded offspring, or remain attached to deleted hosts; host death releases or transfers each parasite once, and a no-host fixture exhausts its free-stage reserves.

### P16 — Disturbance, dispersal, dormancy, and food-web extensions

**Depends on:** P07–P10, P12; P15 for disease disturbances.

**Tasks**

- Add multiple habitat patches connected by explicit corridors/currents, costly dispersal, barriers, and local resource specialization.
- Add dormancy/resting eggs with entry/exit conditions, low maintenance, finite viability, and investment costs. Dormancy is not free immortality.
- Add a documented disturbance scheduler: nutrient pulse, oxygen crash, warming, habitat removal, toxic spill, invasive-founder introduction. Record all removals/imports in ledgers and manifests.
- Add explicit decomposer and scavenger founder templates, multiple producer types, and environmental resource storage after their base pools are stable.
- Add adaptive foraging and niche-specialization experiments through existing genes/sensors rather than hard-coded species boosts.
- Add a bounded mutualism/niche-construction subtask: organisms may deposit costed nutrient-rich waste, alter a local refuge structure, or exchange a resource via existing transfer primitives. Each action must have finite material/energy cost, local reach, decay/removal behavior, and ledger effects. Compare the action enabled/disabled; do not award an abstract cooperation bonus. Territorial and parental-guarding behavior may use movement, recognition, and signals, without unobservable ownership or guaranteed offspring protection.
- Add population recovery, recolonization, spatial diversity, patch occupancy, and resilience diagnostics with defined time horizons.

**Gate:** disconnected patches do not exchange organisms/material without a modeled path; dormancy preserves budgets and costs; disturbances replay exactly; export/import fluxes reconcile. Recovery metrics include extinctions and permanent losses rather than only surviving patches.

### P17 — Calibration, presets, documentation, and release review

**Depends on:** all implemented phases; run smaller versions of these checks throughout.

**Tasks**

- Ship documented presets: legacy foraging; shared-sensor rule baseline; neural foragers; rule predator–prey; neural predator–prey; nutrient cycling; seasonal habitat; neural-size comparison; sexual diversification; topology evolution; signaling; epidemic; disturbance recovery.
- Give each preset a question, enabled mechanisms, units, parameters, root seeds, expected qualitative possibilities, and known limitations. Do not hard-code a successful trajectory into it.
- Calibrate coefficients against internal budgets and intended timescales. If a real organism/system is later selected, add independent empirical data and validation; do not imply this abstract model already predicts it.
- Run held-out seeds and sensitivity/ablation studies. Record failed, extinct, and limit-censored runs.
- Complete local launch/recovery instructions, keyboard controls, model description, experiment exports, feature limitations, and compatibility/migration notes.
- Verify the full user path inside VS Code: start server → load preset → inspect → adjust neural settings → apply/restart → pause/step → save → reload → compare. Record actual validation; do not claim browser QA if it was not performed.

**Gate:** release checklist in section 12 passes, all included presets load, every enabled module has tests and documentation, and no setting merely changes a label without affecting the model.

### Starter presets and fixture values

Use these as explicit implementation starting points, then version any adjustments. They are artificial calibration choices, not biological measurements.

- **Legacy preset:** retain the reviewed 1000 × 700 world, 64 founders, 230 particles, and existing original trait ranges in its isolated compatibility fixture.
- **First predator preset:** start with 100 grazers and 8 hunters in a 1000 × 700 bounded world at 30 Hz; use shared-sensor rule controllers first. Begin with adequate finite edible reserves, then tune productivity, attack cost, digestion, maturation, and reproductive investment using multiple seeds. Enable neural founders only in the separate neural preset. Never interpret these founder counts as a stability guarantee.
- **Combat fixture:** two 20-health organisms, 12 EU reserves each, contact-eligible 20-damage attacks costing 2 EU, no armor, and one-second cooldown. Both committed simultaneous attacks kill. Expect exactly two deaths/carcasses, 4 EU attack dissipation, and the remaining tissue/reserve energy transferred once. Repeat with insufficient attack energy and out-of-range separation to verify rejection.
- **Feeding fixture:** a 10 EU food pool, two simultaneous 8 EU bite requests, and empty 20 EU-capacity guts. Total ingestion is exactly 10 EU regardless of storage permutation; the declared arbitration decides the split. At 75% energy assimilation, eventual reserve gain totals 7.5 EU and the remaining 2.5 EU is assigned to declared waste/heat pools, never both.
- **Birth fixture:** a 100 EU parent spends 30 EU total, delivering 20 EU reserve plus 8 EU tissue energy to an offspring and dissipating 2 EU. The remaining parent has 70 EU in the affected energy account. Tissue nutrient investment transfers separately; with no nutrient available, tissue cannot be created.
- **No-input fixture:** disable primary production and external food/chemical-energy input. With maintenance enabled, total usable stored energy declines; a perfectly closed recycling loop must not become a perpetual-energy source.

Before integrating each fixture into a richer world, supply all other coefficients as zero or explicit fixed values so the test isolates one mechanism. In `docs/PARAMETERS.md`, record every parameter's symbol, unit, range, default, rationale, affected subsystem, restart/live-edit policy, and calibration status. Add a monotonicity or boundary test where the parameter has a defined expected effect.

## 7. Feature dependencies and parallel work

Critical path to predators:

```text
P00 → P01 → P02 → P03 → P04 → P05
                         ↓        ↓
                        P06 → P07 → P08
```

Use the explicit dependency lists above when the simplified drawing omits an edge. Develop checkpoint schema hooks from P01 onward; complete P09 before long-running P10 experiments. Work on P11 profiling early, then finish worker parity after state contracts stabilize.

Independent work suitable for separate agents after contracts are agreed:

- Render/camera/UI work against immutable snapshot fixtures.
- Ecology/physiology systems against transfer and contact contracts.
- Controller/genome modules against versioned observation/action contracts.
- Headless tests, benchmark harness, documentation, and experiment diagnostics.

Give each agent file ownership and a bounded deliverable. One integrating agent owns `world.js`, public schemas, tick order, and migrations. Do not concurrently change shared observation layouts or merge unversioned state schemas. Integration runs shared fixtures and hashes before accepting a task.

## 8. User controls and observability requirements

### Experiment setup — restart required

Seed; preset/model version; founder counts and density policy; world size/boundaries; habitat generator; founder diet/traits; controller type/count/depth/width; sensor schema; reproduction mode; optional ecology modules; neural structural limits; technical budgets.

### Live controls — recorded interventions

Pause/resume/single step; requested speed; nutrient/light/temperature changes; scheduled predator introduction; explicit resource additions; habitat edits; selected supported mutation policy changes. Record **model-affecting** changes with tick/sequence and old/new values. Playback, camera, selection, and display choices are UI state and must not affect model hashes.

### Display-only controls

Pan/zoom/follow; coloring by diet, lineage, energy, age, or brain size; field layers; sensor cones; selected path; contact/attack overlays; graph window; neural module selector. Avoid rendering all overlays by default.

### Inspector

Identity, founder/parents, age/stage, observed trophic role, phenotype, inherited genome changes, reserve/gut/health/stamina, spending breakdown, sensed values, raw intent versus constrained action, neural architecture/activation/memory, last food/attack events, offspring, death reason, and lineage links. A dead selected organism should remain inspectable through a summary record.

### Experiment charts

Label simulation time, measurement units, sample interval, role/lineage classification, sample count, and whether lines represent one run or a replicate aggregate. Show population and biomass separately. Plot energy/nutrient residuals in diagnostics. Report maximum generation alongside age/cohort statistics rather than treating it as a measure of evolutionary progress.

## 9. Performance and technical-limit gates

These are proposed engineering targets, not current measured capabilities. Record machine, browser/Node version, model version, seed, configuration, and measured percentiles. Adjust targets only with an explicit benchmark report.

- **Interactive target:** 1,000 mobile organisms, 10,000 resource items or equivalent grid cells, 128 × 128 environmental fields, 1 network with two 12-wide hidden layers, decisions at 5 Hz. Target sustained 30 model ticks/s and 30 FPS, with control acknowledgment under 100 ms on the declared reference machine.
- **Small default preset:** comfortably below that budget and readable in a VS Code editor pane. At maximum supported brains, show reduced feasible entity budgets rather than promising the default speed.
- **Stress target:** 5,000 organisms headlessly. Target finite, bounded, resumable execution and measured throughput; do not promise real time.
- **Memory target:** under 256 MB of application-owned buffers/state for the interactive fixture, excluding browser overhead; explicitly account for genomes, field buffers, snapshots, and diagnostic retention.
- Keep per-tick neighborhood work local; benchmark dense clusters as well as uniform distributions because spatial hashing does not eliminate worst-case all-neighbor work.
- Bound event, path, trace, and metric history. Retain aggregate lineage summaries and selectively sampled detailed records; never let every tick store every genome.
- Distinguish ecological carrying capacity from technical entity/memory limits. Hitting a technical limit pauses/censors the experiment and is included in outputs.
- Optimize only after profiles identify the cost. Do not reduce sensing accuracy, alter RNG order, or drop biological ticks invisibly to improve FPS.

## 10. Validation suite and experiment matrix

### Deterministic unit/integration fixtures

- Tick scheduling, RNG stream serialization, command order, invalid configuration.
- Spatial queries versus brute force, toroidal seams, exact overlaps, zero distance, narrow obstacles, contact tunneling.
- Sensor masks, FOV/occlusion, normalization bounds, absence of inaccessible information.
- Attack reach, cooldown, simultaneous attacks, mutual kills, blocked attacks, carcass uniqueness.
- Contested feeding, partial bites, gut capacity, digestion, resource/energy transfer identities.
- Starvation, injuries, senescence, reproduction investment, embryos, juvenile maturation.
- Genome independence, mutation limits, sexual recombination/alignment, structural network validity, memory reset.
- Field transport, conservative nutrient fluxes, no negative concentrations, grid-resolution convergence at fixed physical scales.
- Checkpoint round trips, old-version migration, corrupt file rejection, worker/headless parity.
- Empty/extinct worlds, one organism, all predators, no food, very dense birth sites, maximum supported topology, every optional module disabled.

### Property and stress checks

For generated valid configurations and seeded long runs, assert finite state, legal bounds, unique IDs, one death per individual, no duplicate food transfer, bounded costs, valid graphs, and ledger residual tolerance. Do not make exact ecological outcomes a generic invariant.

Run a simulated-hour soak for the reference preset plus smaller extreme scenarios. Check retained memory plateaus and checkpoints remain readable. A crash is a failure; ecological extinction is a result unless a specific fixture requires survival.

### Comparative experiments

1. Rule baseline vs one neural controller with identical sensors/actuators.
2. Network count 1/2/4 at fixed width/depth; repeat at approximately matched parameter budgets to separate ensemble size from raw capacity.
3. Depth and width sweeps with architecture-specific parameter/compute costs visible.
4. Predator ratios with and without refuges, prey sensing, and stamina limits.
5. Mutation probability and magnitude independently, including zero mutation.
6. Stable vs seasonal/patchy resources, with shared environmental seeds.
7. Closed nutrient cycling vs external food subsidy, with budgets disclosed.
8. Memory on/off, communication on/off, and infection on/off within matched models.
9. Fixed vs evolving topology, reporting size, expenditure, survival, and reproduction rather than just a single fitness number.
10. Sexual vs asexual reproduction, with matched investment assumptions and population-size sensitivity.

Use a small smoke matrix (for example five explicit seeds) during development. For release comparisons, start with at least 30 independent seed replicates per configuration and a predeclared duration; expand if uncertainty remains large. Thirty is a practical starting budget, not a guarantee of statistical power. Keep tuning seeds separate from held-out evaluation seeds. Include technical-limit censoring in summaries.

Suggested future commands, to be implemented by the relevant phase:

```sh
npm test
npm run test:integration
npm run benchmark -- --preset interactive-reference
node scripts/run-experiment.mjs --manifest experiments/predator-baseline.json
```

Only `npm test` and `npm start` exist at the reviewed baseline. Do not claim the future commands currently work.

## 11. Scientific documentation and design references

Maintain `docs/MODEL_SPEC.md` with purpose, entities/state/scales, scheduling, design concepts, initialization, inputs, submodels, equations, and parameters. This organization follows the ODD model-description approach; it makes assumptions inspectable rather than validating them by itself. See [Grimm et al., ODD protocol update (2020)](https://www.jasss.org/23/2/7.html).

Use a simple producer–grazer–predator experiment as an early regression/learning scenario. The [NetLogo Wolf Sheep Predation model](https://ccl.northwestern.edu/netlogo/models/WolfSheepPredation) provides a useful documented example of resource renewal, energy costs, reproduction, and extinction dynamics. Use it as conceptual reference; do not copy its source or expect identical curves from different rules.

For topology evolution and homologous crossover, consult [Stanley and Miikkulainen, Evolving Neural Networks through Augmenting Topologies (2002)](https://nn.cs.utexas.edu/downloads/papers/stanley.ec02.pdf). The planned ecological controller is not automatically NEAT: algorithmic speciation/fitness sharing and ecological reproduction are different mechanisms.

All equations, numeric bounds, thresholds, target budgets, and phase ordering in this plan are proposed design choices for this repository, not parameters established by those references. For any later empirically grounded biological feature, attach a direct primary source and document applicability, fitted values, uncertainty, and validation data before calling it realistic for a named organism.

## 12. Final acceptance checklist

- [ ] Local launch and VS Code integrated preview work without account, deployment, or external ML service.
- [ ] Black scientific interface is readable at narrow and wide pane sizes; controls are keyboard accessible.
- [ ] Fixed ticks and replayable interventions are independent of frame rate and inspection.
- [ ] Predators find, pursue, injure, kill, and feed through local sensing and finite transfers.
- [ ] Prey can detect, evade, hide, feed, mature, and reproduce under the same physical constraints.
- [ ] Network count/depth/width controls alter actual controllers; pending/live changes are clear.
- [ ] Genes, phenotype, controller memory, and lifetime state are separate and serialized correctly.
- [ ] Energy, nutrient, reproduction, and carcass accounting pass fixtures and long-run checks.
- [ ] Resources, environment, developmental stages, and optional modules affect documented model processes.
- [ ] Save/load continuation, command replay, headless batches, and worker execution agree within their declared guarantees.
- [ ] Metrics identify causes, units, roles/clusters, uncertainty, extinction, and censoring accurately.
- [ ] Technical limits never masquerade as ecological carrying capacity or successful stability.
- [ ] Every included realism module has an isolated test, a preset/experiment, an off mode, and a limitations note.
- [ ] Benchmark and soak evidence is recorded; performance claims specify workload and machine.
- [ ] No unimplemented setting, silent placeholder mechanic, unexplained global fitness bonus, or automatic resurrection remains.
- [ ] Model/schema versions, README, parameter registry, phase status, and experiment examples are current.

## 13. Copyable handoff prompt for an implementation agent

> Implement the evolution-simulator roadmap in `IMPLEMENTATION_PLAN.md`, starting from the existing files rather than replacing the application wholesale. Read the plan, README, current source, and any applicable repository instructions first. Create/update `docs/IMPLEMENTATION_STATUS.md` and execute phases in dependency order. Preserve local VS Code use and the black scientific interface. Deliver the P00–P05 predator release first, then continue through the remaining roadmap unless I set a smaller scope. Keep every phase functional, tested, and documented. Make routine design choices from the contracts in the plan; record justified deviations. Separate simulation state from rendering, use deterministic fixed ticks, and make all transfers, selection effects, and interventions explicit. Do not publish the application or present speculative biological realism as validated. Report completed phases, tests, measured limitations, and the next phase with each handoff. If parallel agents are available, give them bounded tasks with clear file ownership after shared schemas are agreed.
