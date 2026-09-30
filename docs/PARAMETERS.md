# Parameter registry — legacy-v1

All quantities use abstract simulation units. Defaults and constants below describe existing code. They are artificial design values, not biologically calibrated coefficients. P00 validates supported inputs without exposing new ecological controls.

## Validated experiment and input settings

- `schemaVersion`: integer enum 1. Setup only. Parsed-preset format version.
- `modelVersion`: enum `legacy-v1`. Setup only. Current model identity.
- `seed`: uint32 0…4294967295; default 90210. Setup only. Initializes the world RNG; brain RNG starts at `(seed + 12345) >>> 0`.
- `mode`: `rule` or `neural`. Setup only in presets; must agree with zero or positive network count. The constructor/UI derive behavior from count.
- `world.width`: 1000 LU, fixed in this version. Integer; other values rejected by preset validation. Used in positions, bounds, wall sensors, and rendering.
- `world.height`: 700 LU, fixed. Same policy as width.
- `initial.organisms`: integer 64, fixed. Setup founder population.
- `initial.food`: integer 230, fixed. Setup particle population.
- `neural.count`: integer 0–4, default 0. Restart required. Zero selects rule behavior; positive values are equally averaged networks.
- `neural.depth`: integer 1–3, default 1. Restart required. Number of hidden layers, validated even when count is zero.
- `neural.width`: integer 2–12, default 6. Restart required. Uniform hidden width, validated even when count is zero.
- `renewal`: finite 0–100, default 60. Live setter. Expected resource arrivals per second = value × 0.18, subject to cap. UI displays percent; it is a relative control, not a measured nutrient concentration.
- `mutation`: finite 0–100%, default 12%; UI restricts slider to 0–60%. Live setter, affecting subsequent births. Same probability for independent trait and weight mutation events; does not alter existing adult weights.
- `dt`: finite positive seconds <= 1. Step-call input. Guard added by P00. UI substeps are <= 1/30 second; arbitrary accepted dt values do not imply consistent ecological results across step sizes.

## Random initialization and inherited trait bounds

- Founder x/y: uniform `[0,1000)` / `[0,700)` LU. Children inherit parent position.
- Founder/child heading: uniform `[0,2π)` radians.
- Founder energy: uniform `[65,115)` EU; offspring energy: 65 EU.
- Founder age/generation: 0 s / 1. Offspring age/generation: 0 s / parent+1.
- Speed: founder `[18,40)` LU/s; inherited clamp `[12,60]` LU/s.
- Sensing radius: founder `[60,110)` LU; inherited clamp `[35,170]` LU.
- Body size: founder `[4,6)` abstract LU; inherited clamp `[3,9]`. It affects draw size, bite distance, and expenditure; no body mass is tracked.
- Hue: founder `[85,160)` degrees; inherited clamp `[75,180]`. Display-only trait, despite being mutated genetically.
- Trait mutation magnitude: up to ±17.5% of the inherited bound span per mutation; resulting trait clamped to bounds. Formula is `(random - 0.5) × span × 0.35`.

These are internal constants, not separate UI controls. Changing them changes model semantics and requires updated version/characterization evidence.

## Neural constants

- Seven sensor inputs; two outputs (turn, throttle). Exact order is documented in MODEL_SPEC.md.
- Initial weights/biases: `(2r - 1) × sqrt(2 / inputWidth)`; output and hidden activation: tanh.
- Bias count: one per non-input neuron.
- Decisions scheduled at `current time + 0.2 s`; nominal 5 Hz with legacy drift.
- Turn coefficient: 3 rad/s × output.
- Throttle lower bound: 0.15; upper bound: 1; affine mapping from tanh output.
- Weight mutation offset: `0.8 × (r - 0.5)`, bounded ±0.4 before clamping.
- Inherited weight clamp: [-4,4]. Full replacement/topology mutation not supported.
- Wall sensing strip: 60 LU; thresholds x=60/940 and y=60/640.
- Energy normalization divisor: 85 EU, then subtract 1.
- Oscillator angular frequency: 2 radians per simulated second of age.
- Diagnostic evaluator supports 1–4 computational layers with widths up to 12 and exactly two final outputs. Founder creation always uses the stricter count/depth/width architecture. Direct one-layer networks are allowed for deterministic test fixtures.

## Ecological rates, thresholds, and limits

- Basal expenditure: 0.7 EU/s.
- Movement coefficient: 0.022 EU per distance unit; actual term = speed × throttle × coefficient.
- Sensing coefficient: 0.004 EU/(s·LU) × sensing radius.
- Size coefficient: 0.07 EU/(s·size unit) × body size.
- Neural coefficient: 0.00015 EU/(s·parameter) × weights+biases across networks.
- Food award: 29 EU per consumed particle; energy cap: 170 EU. Excess energy is discarded in the current model.
- Feeding reach: body size + 5 LU; strict pre-movement distance comparison.
- Reproduction threshold: energy > 135 EU and age > 7 s.
- Parent reproduction debit: 68 EU; child reserve endowment: 65 EU; implicit untracked difference: 3 EU.
- Death filters: energy <= 0 EU or age >= 160 s, applied after reproduction.
- Live/queued population cap: 350. It suppresses reproduction silently in legacy-v1.
- Food cap: 650. It suppresses generation silently in legacy-v1.
- Renewal conversion: 0.18 arrivals/(s·slider unit), maximum nominal 18 particles/s before cap.

## Scheduling and display constants

- UI speeds: 1×, 3×, 8× requested speed; simulation time derives from animation elapsed time.
- Frame delta clamp: 0.06 s; subdivision maximum: 1/30 s, with variable remainder.
- Population history: sampled when integer time changes; maximum 120 entries.
- UI metric refresh: roughly every 200 ms of animation time.
- Selection radius: 24 world units, independent of rendered body size.
- Eye/body renderer ellipse: radius multipliers 1.45 and 1; no collision semantics.
- Reduced-motion preference starts paused.

## Validation evidence and calibration policy

`tests/config.test.mjs` covers valid bounds, invalid types/modes/shapes, atomic failure, sensor/output shape, and parent compatibility. `tests/boundaries.test.mjs` covers resource absence, extinction, boundary positions, inheritance extremes, cap behavior, and the legacy mortality ordering. `tests/legacy.test.mjs` protects full reference trajectories.

No coefficient is fitted to empirical biological data. Keep valid-configuration trajectories unchanged in P00. Later phases must change the model version or explicitly document intentional deviations; fixture files are not to be regenerated automatically by the test command.

## Predator-v2 registry (2D route)

Every value below is an artificial design coefficient with **uncalibrated** status. LU = abstract length unit, EU = chemical-energy unit, s = simulation second. Changing a fixed coefficient or channel order requires a model-version bump. A technical budget is a censoring limit rather than an ecological parameter.

- `seed` (uint32, default 90210): initialization/RNG; restart only. Separate initialization, environment, mutation, brain and rule-search streams derive from it.
- `world.width`, `world.height` (`W`, `H`, LU; integer 250–4000; defaults 1000, 700): space, bounds, camera, sensor distances; restart only. The range keeps the local 2D experiment tractable.
- `boundary` (enum `reflect`/`periodic`; default `reflect`): motion, local sensing and contact distance; restart only.
- `obstacles` (array of static circles with x/y inside the world and radius 0.25–100 LU; default empty): sight occlusion, swept motion and attack obstruction; restart-only API setting. The page has no obstacle editor yet.
- `fovDegrees` (`φ`, degrees; 30–360; default 360): sensing visibility; restart only. Perfect all-around vision is a declared simplification in the default preset.
- `initial.prey`, `initial.predators`, `initial.food` (counts; 0–350, 0–30, 0–650; defaults 80, 8, 230): founder density and external initial endowment; restart only. Counts are absolute, independent of area.
- `neural.count`, `.depth`, `.width` (integer counts; 0–4, 1–3, 2–12; defaults 0, 1, 6): controller architecture; restart only. Zero networks selects the rule controller. Per-individual parameter count drives controller expenditure.
- `renewal` (`R`, relative UI percentage; 0–100, default 60): external food arrivals; next-tick recorded command. Expected arrivals/s = `0.18 × R`, limited by the declared technical food budget.
- `mutation` (`μ`, percent probability; 0–100 model range, 0–60 UI slider, default 12): inherited speed/sense/size and weight mutations; next-tick recorded command for subsequent births.
- `introducedPredators` (integer 0–30 per command): scheduled founder introduction at any future tick; externally funded reserve/tissue is added to the ledger. Not part of the initial founder count.
- `budgets.organisms`, `.food`, `.carcasses` (integer 1–100000, defaults 350, 650, 350): technical state capacities; setup/restart or explicit increase after a limit. A rejected tick is censored and has no model-state effect.
- `modelHz` (30 ticks/s), `decisionInterval` (6 ticks), `gridCellSize` (64 LU): fixed scheduling and broad-phase search constants. They are model/engineering constants, not live controls.
- `turnLimit` (3 rad/s), `acceleration` (180 LU/s²): fixed actuator limits for rule and neural controllers. Throttle maps the control output to 0–1; neural goal guidance floors throttle at 40%. Swept living-body contact stops overlapping motion, but there is no momentum solver.
- Prey/hunter founder reserve (85–115 / 130 EU), reserve capacity (170 / 230 EU), tissue endowment (32 EU), health (60 / 100), stamina (100), gut capacity (40 / 80 EU): fixed physiological starting stores/bounds. Founder prey reserve is seeded uniform; all other listed founder stores are deterministic by role.
- Prey/hunter bite limit (29 EU/tick / 60 EU/s), digestion rate (45 / 60 EU/s), assimilation (`η`, 0.75 / 0.8): fixed feeding coefficients. Food enters gut first; `η × digested` enters reserve and the rest enters heat.
- Basal cost (0.7 EU/s + 0.07 EU/(s·size unit)), locomotion cost (0.022 EU/LU moved), sensing cost (0.004 EU/(s·LU of sense radius)), controller cost (0.00015 EU/(s·parameter)): fixed expenditure terms, booked separately in `ledger.costs`.
- Attack reserve cost (2 EU), stamina cost (10 points), cooldown (15 ticks), unarmored damage (30 health points), armor deduction (1 damage point per armor point): fixed combat coefficients. Damage is simultaneous across eligible attackers.
- Stamina recovery (12 points/s at 0.05 EU/point), health repair (1 point/s at 0.3 EU/point): fixed maintenance coefficients. Recovery/repair stop when no reserve is affordable.
- Reproduction maturity (10 s), prey/hunter reserve threshold (>140 / >180 EU), investment (90 EU), child reserve/tissue (55 / 32 EU), dissipated birth cost (3 EU), cooldown (150 ticks): fixed asexual birth coefficients. Tissue nutrient cost remains unmodeled.
- Prey/hunter maximum age (160 / 200 s), carcass decay (1% of remaining EU/s): fixed mortality and dissipative-decay coefficients.

`tests/predator-v2-foundation.test.mjs` checks world bounds/periodic geometry, command timing and technical-limit boundaries. `tests/predator-v2-physiology.test.mjs` checks FOV absence, stamina/armor attack boundaries and 75% assimilation. `npm run benchmark:predator` declares the performance workload. These tests establish implementation behavior, not empirical calibration.
