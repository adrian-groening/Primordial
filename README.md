# Primordial

A local 2D predator–prey evolution sandbox with a dark experimental interface.

## View inside VS Code

1. Run **Terminal → Run Task → Evolution: start local simulation**.
2. Open the command palette and choose **Browser: Open Integrated Browser** (or **Simple Browser: Show** in older versions).
3. Enter `http://127.0.0.1:4173` and keep the preview beside your code.

The server is local to your computer. If it is already running, skip step 1.

## Active 2D simulation

The default preview at `http://127.0.0.1:4173` starts a local predator–prey experiment. Drag to pan, scroll to zoom, click an animal to inspect it, and use the controls to pause, change speed, adjust the world, or restart. **Decision lab** compares two 10-second futures from the same moment, shows what changed, and lets you apply the tested food setting. **Skyfall** sends a localized impact through the world and leaves carcasses for the surviving predators. Body size, tail length and feelers show inherited size, speed and sensing; color and markings are inherited too. Neural organisms have a Goal turn input and guided movement toward food or prey, away from threats, or along an exploration heading. The canvas follows the world's aspect ratio so the default view fills it without black bars. The previous `/predator.html` URL remains available.

See [the current model documentation](docs/PREDATOR_V2_MODEL.md) for mechanics, tested behavior and limits. The 2D model is still incremental; [implementation status](docs/IMPLEMENTATION_STATUS.md) lists open phase gates. Original legacy fixtures remain protected.

## Preserved 3D prototype

The former 3D planet is no longer the default page. Its HTML, JavaScript, model, genetics, rendering code, styles, tests and [model notes](docs/PLANET_MODEL.md) are retained. Open `http://127.0.0.1:4173/planet.html` to revisit it. The 2D model now carries over the 3D prototype's occupied-space rule for living organisms; the implementations remain separate.

## Development roadmap

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the roadmap, including richer ecology, neural evolution, reproducible experiments, dependencies, and acceptance criteria. The phase tracker records what is implemented and verified.

## Implemented foundation (P00)

The preserved legacy behavior is documented in [MODEL_SPEC.md](docs/MODEL_SPEC.md), with exact defaults and units in [PARAMETERS.md](docs/PARAMETERS.md). See [implementation status](docs/IMPLEMENTATION_STATUS.md) for verified work and the next phase.

Run `npm test` for validation, boundary cases, inheritance, and exact legacy trajectory checks. Tests use Node's built-in test runner; no test framework or runtime npm packages are required. The recorded baseline runtime is Node 23.11.0 (see fixture metadata). Other runtimes can run the suite, but a numerical/hash difference must be investigated rather than silently overwriting expected results.

`dist/presets/legacy-v1.json` is a validated setup preset. From JavaScript, pass its parsed contents to `Ecosystem.fromConfig(config)`; there is not yet an import/preset UI. Existing constructor calls remain supported for valid seeds/architectures. Invalid configurations now throw clear errors instead of being rounded or clamped. World dimensions and founder counts remain fixed in this model version.

`npm run benchmark:legacy` measures three seeded headless scenarios. The P00 result is recorded in [P00_BENCHMARK.json](docs/P00_BENCHMARK.json); it does not measure browser frame rate.

`npm run benchmark:predator` measures rule, neural and dense-cluster 2D workloads. The current result is [PREDATOR_V2_BENCHMARK.json](docs/PREDATOR_V2_BENCHMARK.json). This is headless Node throughput, not browser frame rate.
