# Implementation status

## P00 — Characterize and document the current model

**Status: verified.**

Completed work:

- Formatted authored JavaScript, HTML, CSS, tests, and launch/package metadata using Prettier 3.3.3 without adding a runtime dependency.
- Captured pre-change legacy-v1 fixtures at 0, 30, and 1,800 steps for zero, one, and four networks.
- Added strict constructor, neural, preset, live-rate, timestep, and sensor/weight validation.
- Added a versioned legacy preset and `Ecosystem.fromConfig` API.
- Added current-model documentation, parameter registry, and regression/boundary tests.

Evidence:

- `npm test`: 20 tests passed; exact legacy hashes unchanged for all three architectures.
- All five authored JavaScript entry/modules passed `node --check`; local entrypoint and seven assets/modules returned HTTP 200; relative module imports resolve.
- `npm run benchmark:legacy` is available; recorded headless benchmark: [P00_BENCHMARK.json](P00_BENCHMARK.json). This is not browser FPS evidence.
- Browser interaction/visual QA was not performed for this formatting/validation stage.
- Source fixture runtime: Node v23.11.0; exact V8/platform metadata in tests/fixtures/legacy-v1.json.
- Invalid dt/rate assignments leave current state unchanged; zero renewal reaches extinction without reseeding.

Limitations retained deliberately:

- Frame-dependent subdivision, unequal rule/neural actuators, pre-movement eating distance, silent caps, and age-expired reproduction are documented legacy behavior.
- No predator mechanics, fixed-tick kernel, checkpoint UI, or new experiment controls are implemented in P00.
- Full neural input/weight checks favor early error detection; optimized compiled validation belongs to a later profiling phase.

Next action: continue from the P01–P05 work below while preserving legacy fixtures.

## Historical user-prioritized predator-v1 release — verified at that increment

The user requested predators immediately after P00. A focused `predator-v1` model was delivered and later superseded by predator-v2 on the 2D page. This historical increment delivered a subset of P01/P03/P04/P05 without claiming those entire phases complete.

- Added hunters, escaping prey, health, contact-gated attacks, cooldowns, finite carcasses, diet restrictions, starvation, role-preserving reproduction, and energy accounting.
- Added 30 Hz model ticks and 5 Hz shared control cadence.
- Added 11-input/3-output neural controllers and matching live diagrams for both roles.
- Added founder-predator settings, separate counts/history, hunt/injury visuals, and predator inspection.
- Validation: 35 tests pass, including all legacy trajectory fixtures and 15 new predator/model/UI-wiring tests.
- Three seeded five-minute runs balanced energy within 1e-5; all eventually experienced overhunting/extinction. Sustained-coexistence calibration is not claimed.
- Detailed behavior and remaining limitations: [PREDATOR_MODEL.md](PREDATOR_MODEL.md).
- Local-only workflow retained; browser visual QA not performed.

## P01–P05 execution pass — 30 September 2026

The requested five-phase slice advanced P01–P05 in the 2D predator route while leaving the separate 3D planet route and legacy trajectory fixtures functional. `predator-v2` is a new model/schema interpretation. These phases remain **in progress** because their full acceptance gates in the roadmap have not all passed.

- **P01 — in progress.** Artifacts: `dist/sim/tick-clock.js`, `commands.js`, `random.js`, tick-stamped command queue/log, separate RNG streams, conditional staged `stepTick`, technical-limit rollback/resume, model state export/restore hook, `createWorld`/`stepWorld`/render-snapshot facade. Evidence: `tests/predator-v2-foundation.test.mjs` compares one-founder state at tick 18,000 across 30/60/144 Hz schedules, tests command order and 1×/3×/8× clock requests, and proves limit rejection preserves state/RNG before a raised-budget continuation equals an unrestricted run. The UI requests at most eight ticks/frame and shows selected versus actual speed. Next: long-lived nonempty 18,000-tick canonical hash fixture, more complete controller/render separation, and robust checkpoint validation. Direct system methods are still mutable fixture APIs.
- **P02 — in progress.** Artifacts: `dist/sim/spatial-grid.js`, `obstacles2d.js`, validated 250–4000 LU width/height, reflecting/periodic boundaries, local FOV query, velocity/acceleration, `dist/render/camera2d.js`, pan/zoom/fit/follow and restart settings. Evidence: seeded grid queries match brute force at periodic seams and corners; camera round-trip test; integrated VS Code browser loaded the route and displayed a circular, letterboxed field. Next: obstacle setup/editor, more obstacle geometry and contact fixtures, richer versioned contact records, and visual recheck after the final layout reorder.
- **P03 — in progress.** Artifacts: finite gut/bite/digestion, reserve/tissue/health/stamina stores, named heat-cost terms, one-time carcasses and death causes, atomic organism/food/carcass technical budgets. Evidence: 10 EU contested food → 7.5 EU reserves + 2.5 EU heat fixture; existing combat, extinction and energy residual tests pass. Next: limiting-nutrient ledger, growth/development and reproduction tissue transfers, body catabolism, and broader isolated repair/death-cause fixtures.
- **P04 — in progress.** Artifacts: role-specific diets and assimilation, local rule pursuit/flee, stamina- and armor-constrained simultaneous contact attack, scheduled predator introduction with external-energy accounting, role counts and inspector. Evidence: existing attack/kill/contested-carcass/starvation fixtures plus new armor/stamina fixture and live inspector check. Next: refuge, pursuit stamina/rest, handling costs, configurable trophic traits, disclosed coexistence/extinction seed set, and richer mortality/attack rates.
- **P05 — in progress.** Artifacts: `predator-observation-v2` with 22 channels and five outputs, 0/1/4 network settings, per-organism controller cost, bounded FOV masks, on-demand selected trace, pending architecture/restart labels. Evidence: hand-set lateral-food turn fixture, absent-target mask fixture, both-role neural tests at 1 and maximum settings, DOM control test, live predator inspector. Next: fixed sensory sectors, noise, evaluation-work cost, saturated/action-constrained inspector values, and a complete no-hidden-information audit.

Validation at this phase: `npm test` passed all 69 tests on Node v23.11.0. Later performance work updated [PREDATOR_V2_BENCHMARK.json](PREDATOR_V2_BENCHMARK.json); the original one-network result was about 91 ticks/s headlessly. A live VS Code integrated-browser check confirmed route loading, ongoing ticks and a selected hunter's reserve/gut/health/stamina fields. The final CSS reorder was not visually rechecked because the shared browser navigated away. [PREDATOR_V2_MODEL.md](PREDATOR_V2_MODEL.md) records equations, units, schema and remaining limits.

## 2D default, viewport, and body space — 30 September 2026

The default `/` page now opens the 2D predator simulation. The previous 3D planet remains intact at `/planet.html`, including its model, genetics, body exclusion and territory code; `/predator.html` still opens the 2D page. The 2D canvas tracks world aspect ratio, fills its available width at narrow layouts, and uses a clamped cover camera so zoom and pan cannot expose black side bars. A live Safari check confirmed the side bars are gone at desktop width; narrow-width visual validation remains open.

P02 now also includes occupied-space placement for founders and offspring, swept living-body contact during movement, periodic-seam exclusion, and a deterministic moving-body priority. A birth waits without an energy debit when no free site is found. Body contact still has a simple stop response; momentum, crowd forces and the 3D territory mechanic have not been ported. Four focused 2D space tests cover reproducing runs, seam/swept contact, array-order independence and crowded birth deferral. At that stage the headless 300-tick rule benchmark took about 0.63 s on Apple M3 Pro; browser frame rate remains unmeasured.

## Inherited 2D appearance — 30 September 2026

The 2D drawing now exposes inherited traits directly: body dimensions reflect size, tail length and body taper reflect movement speed, and feelers reflect sensing range. Pigment and marking intensity/count are newly inherited cosmetic genes that mutate without drawing from the ecological RNG streams. The inspector and canvas legend explain the mapping. The render snapshot includes these traits for future display adapters. Appearance changes are confined to the 2D predator model; the preserved 3D planet remains available.

## Goal-guided neural movement — 30 September 2026

The active 2D controller now uses `predator-observation-v3` with a 23rd input labeled Goal turn. It points toward visible edible targets, away from visible threats, inward from nearby walls, or toward a stable exploration heading. Neural turn is blended with this goal and throttle has a 40% floor; visible edible and hunt targets request the corresponding interaction, still subject to physical and energy gates. This addresses random networks that repeatedly turned in place. State version 2 predator-v2 checkpoints are upgraded on restore with a zero-weight goal input; the old weights remain intact. Four focused tests cover goal direction, actual food approach, a turn-biased network's noncircular exploration, and checkpoint migration. Before performance work the 300-tick one-network headless benchmark reached about 88 ticks/s on Apple M3 Pro. The preserved 3D controller is unchanged.

## 8× playback performance — 30 September 2026

The 2D world now updates in place on ticks that cannot reach a technical budget. Ticks that might hit an organism, food or carcass budget retain staged rollback. This removes full-world copies from normal playback while preserving checkpoint and RNG behavior on rejected ticks. The browser caps each frame's model work at eight ticks and roughly 12 ms, with at most 30 ticks queued. It shows selected and actual speed and labels device-limited playback. The 300-tick one-network headless result rose from about 88 to about 2,100 ticks/s on Apple M3 Pro, exceeding the 240 ticks/s model target for 8×. A 1,800-tick run with four maximum-size networks stayed above 1,600 ticks/s across each 300-tick segment. `npm test` passed 83 tests, including fast-versus-staged state equivalence and food/carcass rollback. Browser frame rate and near-budget neural performance remain unmeasured.

## Hungry predator cannibalism — 30 September 2026

When a 2D predator's reserve plus assimilable gut content falls below 35% of capacity, it can sense and attack another predator or scavenge a predator carcass. Prey is still preferred, and nearby carrion prevents an attack on another predator. The normal contact, stamina, cooldown, damage, carcass and digestion rules apply, so no energy is created. The live ecology note counts predator deaths from predation. Existing predator-v2 checkpoints restore with a zero count for this new metric. The preserved 3D planet logic is unchanged. Focused tests cover cannibal hunting and feeding, prey/carrion preference, neural intent, energy balance and checkpoint migration.

## Skyfall event — 30 September 2026

The 2D page now has a Skyfall button for a seeded, localized impact. The next tick records the command, creates an expanding visual ring, counts impact deaths and leaves ordinary carcasses. Restart gives a clean run. The event uses staged tick rollback if the carcass technical budget is hit. Focused model and UI tests verify the command, casualty count, visual event record and energy balance. The 3D route is unchanged.

## Decision lab — 30 September 2026

The 2D interface now turns an observation into a specific next action. It forks the current checkpoint into two 10-second runs, keeps food arrival unchanged in one and changes it by 20 percentage points in the other, then shows prey/predator/food outcomes and a plain-language takeaway. The user can apply the tested level or resume the original run. The UI pauses the live run while comparing, advances the branches in small batches, and labels technical-budget censoring instead of reporting a misleading result. Model and UI tests verify branch isolation and the apply flow. This is one seeded comparison, not a repeated-experiment result.

## Remaining phases

- **P06 — Heritable physiology, development, and pedigree:** not started. Dependencies and acceptance gate: [implementation plan](../IMPLEMENTATION_PLAN.md).
- **P07 — Primary production, detritus, and nutrient recycling:** not started. Dependencies and acceptance gate: [implementation plan](../IMPLEMENTATION_PLAN.md).
- **P08 — Heterogeneous habitat and environmental change:** not started. Dependencies and acceptance gate: [implementation plan](../IMPLEMENTATION_PLAN.md).
- **P09 — Checkpoints, replay, and local experiment records:** not started. Dependencies and acceptance gate: [implementation plan](../IMPLEMENTATION_PLAN.md).
- **P10 — Repeated experiments and scientific diagnostics:** not started. Dependencies and acceptance gate: [implementation plan](../IMPLEMENTATION_PLAN.md).
- **P11 — Worker execution, scaling, and interface hardening:** not started. Dependencies and acceptance gate: [implementation plan](../IMPLEMENTATION_PLAN.md).
- **P12 — Sexual reproduction and ecological diversification:** not started. Dependencies and acceptance gate: [implementation plan](../IMPLEMENTATION_PLAN.md).
- **P13 — Memory, modular controllers, and evolving neural topology:** not started. Dependencies and acceptance gate: [implementation plan](../IMPLEMENTATION_PLAN.md).
- **P14 — Communication and social behavior:** not started. Dependencies and acceptance gate: [implementation plan](../IMPLEMENTATION_PLAN.md).
- **P15 — Disease, parasites, toxins, and defense:** not started. Dependencies and acceptance gate: [implementation plan](../IMPLEMENTATION_PLAN.md).
- **P16 — Disturbance, dispersal, dormancy, and food-web extensions:** not started. Dependencies and acceptance gate: [implementation plan](../IMPLEMENTATION_PLAN.md).
- **P17 — Calibration, presets, documentation, and release review:** not started. Dependencies and acceptance gate: [implementation plan](../IMPLEMENTATION_PLAN.md).

## Planet and sexual reproduction increment

Implemented a spherical 3D viewport, two-parent mating and funded eggs, persistent-in-session family records, diploid trait inheritance, visible experimental morphology, live atmosphere/terrain controls, and selection on inherited oxygen preferences. See [PLANET_MODEL.md](PLANET_MODEL.md) for scope and limitations. This increment implements subsets of the broader roadmap; it does not complete the remaining ecology, calibration, persistence, and experiment-management phases. Automated model, UI adapter, and scene-structure checks cover this increment; real WebGL visual/performance validation remains separate.

The active planet-v2 startup now uses one common ancestor, funded asexual budding, and a mutable diet gene that determines offspring feeding roles. Separate predator founders have been removed from the active interface. Sexual reproduction remains available between compatible descendants.

Planet-v3 starts two identical asexual founders in distinct lineages. It adds swept spherical body exclusion, unoccupied newborn placement, inherited territory/aggression, energy-funded defensive conflict, selected territory rings, and lineage trait comparisons. Territory is a fixed birthplace claim; rigid-body momentum and learned negotiation remain outside this increment.
