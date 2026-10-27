# Evolving minds and motion artwork

The default 2D engine now runs `predator-v3`, implemented in `dist/sim/evolving-world.js`. It starts with **80 prey, 8 predators, 230 food items, a 1,200 × 800 world, and one two-layer width-8 neural network per animal**. Each network has 37 inputs, 14 outputs and 502 trainable parameters. New local runs and headless experiments require at least one network. The retained 3D prototype also starts with a neural network, but does not implement this 2D learning/ability system. Legacy model classes remain available for regression tests.

## What changes during a lifetime

Animals observe the same local food, threats, bodily state and walls as before, with four recurrent memory values, recent reward, ability readiness, remembered food and nearby signals added. These are numerical observations computed from simulation state. There is no internet dataset or language model controlling these decisions.

At each 5 Hz decision:

1. The organism evaluates the preceding decision's outcome: change in reserve plus assimilable gut energy, injuries, progress toward previously observed food or away from a previously observed threat, funded offspring, and movement stalls. Reproductive energy transfer is compensated in the reward so budding is not treated as a 90-EU behavioral failure. The physical energy ledger is unchanged by reward calculations.
2. A small policy-gradient update adjusts its neural weights using that reward relative to its running reward baseline. Continuous action exploration uses seeded Gaussian noise. The reward baseline, random stream and preceding decision are saved in checkpoints.
3. If survival-reflex training is enabled, backpropagation also trains the policy on local foraging, escape, interaction and memory targets derived from the organism's own observation. This is explicit programmed guidance, not independently discovered knowledge.
4. Its network produces turning, throttle, attack, feeding, reproduction, five ability requests and four memory writes. The memory writes feed back into the next decision. This is one-step recurrent state; it does not use backpropagation through long histories.

Survival guidance initially supplies 65% of turning (80% when escaping). As experience grows and reflex-prediction error falls, an inherited autonomy trait transfers more turning control to the network. Some guidance remains. Feeding and attack assistance also fade with that progress. Learning, reflex training and learning intensity can be adjusted independently; disabling learning freezes weights while neural inference and memory continue.

The reinforcement component is a bounded, one-step policy-gradient update inspired by [Williams's REINFORCE work](https://doi.org/10.1007/BF00992696), combined with supervised survival-reflex training. It is not a full actor-critic system, long-horizon planner, or proof of general intelligence. There is no terminal update after an organism has been removed by death. Dense pre-death feedback and differential reproduction supply the current pressures.

## What evolves between generations

Each organism keeps two separate sets of weights:

- **Starting genome:** the inherited initial policy. It is unchanged by lifetime training.
- **Plastic brain:** the policy used and trained during its life.

Offspring copy and mutate the parent's starting genome and ability genes, then start with empty memories and no experience. Learned lifetime weights and memories are not directly copied into offspring. This lets selection favor useful innate policies, physical strengths and learning capacities. Mutations and selection can improve or worsen outcomes; novelty is not automatically intelligence.

Inherited genes govern learning rate, memory retention, autonomy, dash strength, shielding strength, camouflage, energy assimilation and stamina capacity. Existing speed, sensing, body size, pigment and markings still inherit and mutate. The Ability variants counter counts offspring whose ability genes changed, not established species or a deduplicated biological taxonomy.

## Abilities have physical consequences

- **Dash:** temporarily raises desired movement speed by an inherited factor, subject to the existing acceleration, collision and world-boundary rules. It costs 2 EU and 18 stamina, lasts 0.3 seconds and has a 2-second cooldown. Faster actual movement also pays the existing locomotion cost.
- **Shield:** temporarily reduces incoming attack damage in proportion to its gene. It costs 0.8 EU and 5 stamina, lasts 0.2 seconds and has a 0.4-second cooldown.
- **Signal:** advertises locally observed food or danger to nearby organisms of the same role. It costs 0.4 EU and has a 1-second cooldown. Recipients receive the direction and sign of the nearby signal, not a hidden global map. Signals are a local communication channel within the receiver's sensing range.
- **Rest:** reduces movement to 8% of normal speed and basal expenditure to 55% while tired and not facing a visible threat. Existing paid stamina/health recovery continues. Rest can therefore preserve energy, but loses foraging time.
- **Camouflage:** prey temporarily reduce the distance at which predators can see them, depending on the camouflage gene. Contact at close range remains detectable. Concealment costs 0.3 EU and 1 stamina per 0.2-second activation.

The repertoire is implemented by the simulation. Evolution changes its strength, energetic tradeoffs and learned use; it cannot invent arbitrary actions or bypass conservation, occupancy or world boundaries. Ability activations are requests subject to reserve, stamina and cooldown constraints.

The inspector shows memory span, experience, weight adjustments, recent outcome and ability genes. The live metrics show total learning updates, average neural share of turning, recent mean reward and ability use. These are diagnostic quantities, not an IQ score. Cumulative weight adjustment is total absolute training change, not distance from the starting genome.

## Motion atelier

A separate recorder samples actual engine positions every six ticks (5 Hz) from up to 256 organisms. It retains a live window of at most 30,000 line segments, including paths of organisms that have died. It does not use browser-interpolated movement and does not change model RNG, learning or energy. A periodic seam crossing starts a new path rather than drawing a spurious line through the world.

The local engine continues recording with the browser closed. `paths-<run-id>.ndjson` stores flushed batches on disk; each batch includes stream identity, dimensions and sequence numbers. At extremely high simulation speed, the bounded live ring can overtake a one-wall-second disk flush. A sequence gap then indicates omitted older samples. The in-browser artwork is a bounded live window, not an unlimited full-population archive.

Open Motion atelier below the neural diagram. Choose **Aurora**, **Ember**, or **Individual colors**, then export:

- **SVG:** scalable vector paths from the current retained engine history.
- **PNG:** a 2,400-pixel-wide raster of the currently displayed history, with height bounded to 400–3,200 pixels.

Art recording state is saved with checkpoints and restored with the experiment. New runs reset the artwork. Resizing the world resets the recording coordinate system on its next capture. The viewer polls art separately and groups drawing operations by color to preserve animation responsiveness.

Headless batches write `motion-art.svg`, path records and a complete learning/art checkpoint for every run:

```sh
npm run simulate -- --runs 4 --workers 4 --ticks 1800
```

## Validation and performance

`npm test` covers lifetime weight changes, frozen-learning control, recurrent state, remembered-food expiry, held-out directional policy responses, independent inherited/learned weights, mutated genes, physical ability effects, funded costs, deterministic checkpoint replay and technical-limit rollback. Other tests verify headless path recording, SVG export, checkpoint restoration, bounded path retention and periodic seams.

A controlled neural test trains on left/right food cues and evaluates unseen cue magnitudes. It verifies reduced prediction error and opposite motor responses. That demonstrates this network can learn those targets; it does not establish superior survival across arbitrary environments.

`npm run benchmark:learning` measures three seeded 60-model-second runs at the default population/architecture. [LEARNING_BENCHMARK.json](LEARNING_BENCHMARK.json) records CPU throughput, reward/reflex-error diagnostics, births, generations and mutated ability births. Initial mean reflex error was about 0.95; final error ranged about 0.06–0.14. The runs produced third/fourth-generation descendants. These ecological diagnostics do not isolate the causal survival benefit of learning or prove consistent progress across generations.

Larger populations and brain ensembles remain configurable. Live architecture changes preserve overlapping learned and starting weights separately, and clear the previous training transition so it cannot train an incompatible shape. Start small for live learning; use independent headless workers for larger studies.
