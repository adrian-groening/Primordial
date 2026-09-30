# Planet model

The preserved `/planet.html` preview is a spherical artificial-life experiment, not a calibrated biological simulation. Its dark 3D viewport supports drag rotation, wheel zoom, keyboard navigation, selected-organism focus, and fullscreen. The sphere has about 14.5 times the previous model's total surface area; some of that is water.

## Life cycle and inheritance

The active `planet-v3` experiment begins with two ancestral grazers, Aster and Cinder, with identical homozygous DNA and neural weights but separate positions and lineage IDs. Both reproduce asexually. An eligible adult contributes 90 energy units to budding: 3 become heat and 87 enter an egg. After six simulated seconds it hatches with 55 reserve and 32 tissue units, provided a free habitat position is available; otherwise it waits. Juveniles mature at 18 seconds; parents have a 30-second reproductive cooldown. Neither surviving descendants nor population stability is guaranteed. Sexual reproduction remains implemented and tested as an alternative model mode but is disabled in the active two-lineage experiment. Mate sensor inputs are zero in this mode.

The lineage comparison reports living counts, births, and mean aggression, territory gene, oxygen optimum, and diet. Founders share a genotype but experience different positions and encounters; this comparison is not a controlled causal experiment.

Budding copies both alleles and the parent’s neural modules, then applies bounded mutations. With zero mutation these copies remain identical. Sexual offspring inherit one allele per gene from each parent and neural modules from either parent. Genes express pigment, size, movement, armor, markings, oxygen preference/tolerance, temperature preference, swimming, sensory range, territorial range, defensive aggression, and diet. Mean diet expression starts at 0.45; at 0.6 or above an offspring becomes a hunter. This discrete threshold is an abstract ecological switch, not a realistic model of digestive evolution. No hunters are injected into the population, and their emergence or survival is not guaranteed. Existing adults do not rewrite their DNA when the environment changes. Differential survival and reproduction can change the population's inherited traits. New trait combinations are counted as variants, not established biological species.

In this asexual experiment each offspring retains its sole parent’s lineage. The inspector retains parent and offspring records after death. The live population plus eggs is capped at 400; the pedigree archive at 5,000 records. Reproduction stops at these limits with a visible warning. State is held in memory and resets on page reload.

## Occupied space and territorial conflict

Living animals have exclusive circular footprints on the sphere, including their enlarged visual appendages. Radius is `(0.7 + size × 0.095) × 27` model units. Juveniles reserve their adult footprint so growth cannot introduce overlaps. Swept great-circle collision checks block movement through another animal, not just movement ending inside it. Blocked animals turn aside. Movement priority rotates over time. Founders and hatchlings are placed only in free positions; crowding can delay hatching. This is kinematic exclusion, not a rigid-body momentum simulation.

Each animal claims an area centered at its birthplace, with radius `body radius × (1.5 + territory gene × 3)`. A blocked physical encounter inside that claim can provoke defense. Mature defenders with at least 2 energy try at most once per second; the aggression gene is the probability of striking. A strike costs 2 energy and causes `10 × (1 − victim armor × 0.6)` injury. Damage is resolved together, allowing retaliation. Immature direct offspring are exempt from parental defense. Defense is an inherited reflex independent of the neural predatory-attack output. Territorial rings show the selected animal’s claim; transient red lines mark attacks. Conflict deaths and blocked movements are counted separately from predation.

## Experimental morphology

Organisms use abstract microfauna anatomy: translucent segmented membranes, internal compartments, lateral cilia, respiratory lamellae, mineralized plates, and pigment inclusions. Hunters have a radial capture basket; grazers a finer filtering fan. Body color encodes pigment; body scale encodes size; cilia length encodes movement; plates encode armor; inclusions encode pattern; respiratory folds encode oxygen tolerance. These visual mappings are illustrative, not claims about real microscopic anatomy. Juveniles grow visibly.

## Environment and behavior

Oxygen, temperature, sea level, ruggedness, and fertility can change live. Oxygen outside an individual's inherited comfort interval causes injury; both excess and deficiency can kill. Temperature and poor water adaptation can also cause injury. Terrain affects movement and vegetation affects production. Rising sea level can submerge occupied habitat. The black viewport represents space with a terrain-following 15° coordinate grid. Crosshairs mark vegetation/mineral field samples; individual samples do not have collision physics. The inspector displays model-space XYZ coordinates (radius 900 abstract units) and a unit heading vector; an arrow visualizes the selected heading. Terrain relief is visually exaggerated and organism bodies enlarged for inspection.

Hunters attack at contact, paying energy and inflicting armor-reduced injury. Dead organisms leave finite, decaying food. Grazers consume renewable vegetation. Energy accounting includes metabolism, attacks, reproduction, tissue, food, and decay. Recovery and physiology are simplified. There is no fluid simulation, full nutrient cycle, or automatic repopulation.

Controllers have 14 inputs and four outputs: turn, throttle, attack, reproductive willingness (mating or budding). Architecture controls configure founder network count, depth, and width. Networks inherit and mutate; they do not learn within a lifetime. Model stepping runs at a fixed 30 Hz independently of rendering.

## Validation and implementation

`npm test` covers swept collisions, non-overlap through movement and births, funded/cooldown-limited territorial defense, two asexual founder lineages, mating restrictions, funded eggs, hunter offspring, ancestry after death, inheritance, mutation, oxygen selection, terrain controls, spherical movement, deterministic stepping, energy accounting, renderer structure, and UI wiring. Renderer tests use real Three.js scene objects with a renderer adapter; they do not establish actual WebGL appearance or frame rate.

A seeded 180-second headless test verifies that the single ancestor produces descendants and new variants with balanced energy accounting. Separate controlled mutation tests verify that descendants can cross the diet threshold and hatch as hunters. Earlier mixed-founder benchmark outcomes do not apply to this version.

Code: `dist/sim/planet-world.js`, `planet-neural.js`, `genetics.js`, `sphere.js`, `terrain.js`; viewport: `dist/render/planet-view.js`; UI: `dist/app.js`. Three.js 0.180.0 is vendored locally with its MIT license. No runtime CDN is required. The 2D predator experiment is now the default route; legacy fixtures remain protected.
