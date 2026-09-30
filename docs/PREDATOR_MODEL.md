# Historical model notes: predator-v1

These notes describe the earlier predator increment. The current `/predator.html` route runs predator-v2; see [PREDATOR_V2_MODEL.md](PREDATOR_V2_MODEL.md). The v1 implementation was superseded in place and is not a supported checkpoint format.

At the time of this increment, the local interface ran `dist/sim/predator-world.js`. The original `dist/engine.js` and `dist/neural.js` remain the characterized **legacy-v1** model, with unchanged trajectory fixtures. This was a focused predator release requested after P00, not completion of the entire P01–P05 roadmap.

## Using predators

Refresh the existing VS Code preview at http://127.0.0.1:4173. A new run starts with 80 prey, 8 predators, and 230 nutrient particles.

- Green rounded organisms are prey; orange triangles are predators.
- Founder predators is adjustable from 0 to 30. **Apply & restart** rebuilds the world using that count and the currently active neural architecture. Changing the slider alone does not modify the live world.
- **Inspect predator** cycles through living predators. Clicking any organism still works. The inspector shows role, health, energy, behavior, diet, and inherited traits.
- Injured prey have a health bar. Attacks briefly draw a line between attacker and target. Square remains are finite carcasses.
- Separate counts and history lines show prey and predators; predation deaths and other death counts are displayed.
- Zero founder predators gives a predator-free comparison. Restart retains the active founder count. Applying neural settings also retains the active founder count.

## Controllers and sensing

Both roles use the same 5 Hz decision schedule and bounded 3 rad/s turn actuator. Rule-based prey forage and flee visible local hunters. Rule-based predators pursue nearby live prey or carrion. Visibility is currently distance only, with perfect role recognition: no FOV, occlusion, noise, or learned recognition is implemented.

Neural networks remain controlled by count/depth/width, but the active model uses **11 inputs and 3 outputs**:

1. Food ahead, food lateral, food detected.
2. Threat ahead, threat lateral, threat detected.
3. Normalized energy and health.
4. Wall ahead, wall lateral.
5. Age oscillator.

Food means nutrient particles for prey, and living prey/carrion for predators. Threat means nearby predators for prey; predator threat channels are empty in this model because cannibalism is disabled.

Outputs are turn, throttle, and attack intent. Throttle maps to 0…1; an attack is requested only when its averaged neural output is positive. Attack intent cannot bypass physical range, cooldown, or energy constraints. Feeding is automatic at contact, not a separate neural output. Random controllers may fail to hunt or flee; there is no forced heuristic assistance or lifetime learning.

One hidden layer of width 6 now has 93 parameters. Four networks with three width-12 hidden layers have 1,980 parameters. Diagram labels and displayed parameter/energy costs use the active architecture. The seven-input legacy model is preserved separately, not silently reinterpreted.

## Predator/prey rules

- Prey founder speed: 24–36 units/s; predator speed: 45–55. Inherited clamps: prey 18–48, predator 30–65.
- Founder sensing radius: prey 110, predator 150; inherited clamp 60–200.
- Founder size: prey 4–6, predator 7–9; inherited bounds prey 3–7, predator 6–10.
- Health: prey 60, predators 100. Injury persists; repair, stamina, and armor are not yet implemented.
- Eligible attacks require a living hunter, positive attack intent, at least 2 reserve energy, expired cooldown, and live prey within the two body radii plus 3 units.
- Each attack costs 2 energy and inflicts 30 damage. Cooldown: 15 ticks, or 0.5 simulated seconds. Damage from eligible hunters aggregates before lethal deaths are finalized.
- A kill awards no energy. Death transfers the victim's remaining reserve and 32-unit tissue energy pool to one carcass. Predators consume only prey carcasses at up to 60 energy units/s, subject to reserve capacity. Nutrient particles and predator carcasses are not edible to predators.
- Prey consume finite nutrient energy up to 29 per tick, subject to capacity. Feeding uses current post-movement positions. Tick-varying priorities arbitrate contested meals independently of entity-array ordering.
- Reserve capacity: prey 170, predator 230. Founders begin with prey energy 85–115 or predator energy 130.
- Reproduction requires age >= 10 seconds, energy > 140 for prey or > 180 for predators, and expired reproduction cooldown. Parent debit is 90: child reserve 55, child tissue 32, heat 3. Offspring retain role and inherit independently mutated traits/weights. Parent cooldown is 150 ticks (5 seconds).
- Senescence removes prey at 160 seconds and predators at 200, before they can reproduce in that tick. Empty reserves cause starvation. Predators can overhunt and then starve. Extinction is a legitimate outcome, not automatically repaired.

## Time and accounting

The new world advances in integer 30 Hz ticks, with controllers every six ticks. `step(dt)` accumulates elapsed requested simulation time and executes whole ticks. Rendering partition tests compare 1/30 and 1/60 calls after equal time. This does not yet implement the full P01 command/replay/atomic-limit architecture.

Tick order: nutrient arrivals and carcass decay → age/starvation deaths → snapshot-based sensing and control → movement and expenditure → contact attacks and lethal deaths → survivor feeding → funded reproduction and entity removal → history.

Energy costs retain the original basal, movement, sensing, body-size, and per-parameter coefficients. Tissue energy is an abstract fixed pool, not real biomass. Carcasses decay by 1% of remaining energy per second, dissipated to heat. Nutrient renewal is an external energy source. Founder organisms and initial particles are the recorded initial endowment.

`energyResidual()` checks:

```
current reserves + tissue + food + carcasses
  - initial endowment - external nutrient inputs + cumulative heat
```

Expected residual is zero within floating-point tolerance. Tiny exhausted remnants below 1e-10 are removed; tests tolerate aggregate residual under 1e-6 for their fixtures and 1e-5 for the five-minute runs.

There is no digestion delay or assimilation loss, nutrient/material conservation, carcass tissue development, or full physiological model. These remain roadmap work.

## Limits and remaining roadmap work

Population still has a 350 live/queued birth limit. Attempts beyond it increment `blockedBirths` and display a capacity-limited warning; the run continues. This is explicitly a biased/capped run, not the planned atomic pause/censor implementation. Food remains capped at 650. No spatial grid or worker has been added; this release targets the current small local simulation.

Death summaries retain the latest 50 deaths. Attack indicators retain at most 100 short-lived events. Population histories retain at most 120 one-second samples. There is no checkpoint persistence or complete lineage archive. Raw carcass stores decay and disappear over time.

Legacy documentation is in MODEL_SPEC.md and PARAMETERS.md. Those describe the legacy engine, not active predator defaults. Full P01–P05 completion requires the remaining scheduler/command contracts, spatial indexing/camera, development/digestion, improved sensing, and experiment safeguards.

## Validation

`tests/predators.test.mjs` covers contact range, intent/energy/cooldown rejection, simultaneous hunters, no kill bonus, one-time death, finite contested feeding, no dead feeding/reproduction, local flee/pursuit behavior, post-movement contact, diet restrictions, predator starvation, funded inheritance, neural dimensions, fixed-tick partitioning, seeded predation/reproduction, and predator-free runs.

`tests/predator-ui.test.mjs` imports the actual page module through a DOM adapter and exercises controls, restart, neural/organism inspection, and absence of predators. This is a wiring smoke test, not visual browser QA.

All 35 tests passed after integration, including legacy hashes. Three 300-second rule runs (seeds 42, 90210, 314159) completed without nonfinite state or energy-accounting failure. Their predation counts were 177, 167, and 169. All three ultimately lost both populations; these initial coefficients produce overhunting and are not calibrated for sustained coexistence. More elaborate resource cycling/refuges and calibration remain planned. No browser screenshots or visual interaction testing were performed in this change.
