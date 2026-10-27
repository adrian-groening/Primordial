# Primordial

A local 2D predator–prey evolution sandbox with a dedicated computer-side simulation engine and a browser control panel.

## View inside VS Code

1. Run **Terminal → Run Task → Evolution: start local simulation**.
2. Open the command palette and choose **Browser: Open Integrated Browser** (or **Simple Browser: Show** in older versions).
3. Enter `http://127.0.0.1:4173` and keep the preview beside your code.

The server and simulation engine are local to your computer. If the server is already running, skip step 1. From a terminal, `npm start` runs the same server. The browser is a control panel: closing its tab does not stop a running ecosystem. A server restart restores its latest checkpoint paused.

## Learning, evolving abilities, and motion artwork

New runs start with 80 prey, 8 predators and one compact neural network per animal in a 1,200 × 800 world. Brains now learn during life, remember observations and inherit mutated starting policies and ability genes. Neural actions include dash, shield, signal, rest and camouflage, with energy/stamina costs and physical effects. The inspector and live metrics show experience and ability use.

**Motion atelier** builds artwork from actual recorded paths, including animals that have died. Choose a palette and export SVG or PNG. Recording continues in the local engine with the browser closed. Headless batches also export an SVG per run.

See [EVOLVING_MINDS.md](docs/EVOLVING_MINDS.md) for the learning mechanism, inheritance, limits, art recording and validation. Use `npm run benchmark:learning` for the current learning model.

## Larger runs and saved data

Use **Apply large ecosystem preset** in the panel for 2,000 prey, 100 predators, 12,000 food items and one neural network per animal. **Max** runs as fast as the engine permits, and **Turn visualization off** lets it run with metrics only. Save and restore full neural checkpoints from the panel. The engine autosaves every minute and on clean shutdown, and streams metrics to disk.

Run independent experiments across CPU cores without opening a browser:

```sh
npm run simulate -- --runs 4 --workers 4 --ticks 1800
```

See [LOCAL_ENGINE.md](docs/LOCAL_ENGINE.md) for data locations, larger workloads, CPU limits and validation. `npm run benchmark:scale` measures 2,100- and 10,500-animal neural workloads. The 3D planet remains a browser prototype.

## Active 2D simulation

The default preview at `http://127.0.0.1:4173` controls the computer-side `predator-v3` learning model in a 1,200 × 800 world. Drag to pan, scroll to zoom, click an animal to inspect it, and use the controls to pause, change speed, or adjust the running world without restarting. The Restart button remains available for a fresh run. **Decision lab** compares two 10-second futures from the same moment, shows what changed, and lets you apply the tested food setting. **Skyfall** sends a localized impact through the world and leaves carcasses for the surviving predators. Body size, tail length and feelers show inherited size, speed and sensing; color and markings are inherited too. Neural organisms have a Goal turn input and guided movement toward food or prey, away from threats, or along an exploration heading. The canvas follows the world's aspect ratio so the default view fills it without black bars. The previous `/predator.html` URL remains available.

See [the current model documentation](docs/EVOLVING_MINDS.md) for mechanics, tested behavior and limits. The 2D model is still incremental; [implementation status](docs/IMPLEMENTATION_STATUS.md) lists open phase gates. Original legacy fixtures remain protected.

## Preserved 3D prototype

The 3D planet is available as a separate experiment; it is no longer the default page. Open `http://127.0.0.1:4173/planet.html`. Its behavior layer weighs hunger, injury, fatigue, memory of danger, territory, and familiarity. Neural output shapes choices within survival constraints. Organisms can exchange short generated dialogue at encounters using the locally installed `llama2-uncensored:latest` model. Start Ollama before `npm start`; the planet's Organisms tab shows model status, an automatic conversation toggle, a manual invitation button, and the transcript. Dialogue is expressive only and does not alter physical decisions. The 2D model carries over the 3D prototype's occupied-space rule; the implementations remain separate. See [model notes](docs/PLANET_MODEL.md).

## Fly Brain Lab

Open `http://127.0.0.1:4173/brain-lab.html` after `npm start`, or use **Fly Brain Lab** in the simulator navigation. Replay actual FlyWire v630 spikes, inspect a circuit subset, and compare intact, disconnected and no-input conditions. Configure stimulation, duration and seed to run a new experiment on the full local reference model. The page distinguishes recorded settings from pending controls and labels its diagram as a functional layout. Local Llama 2 can explain recordings as a read-only observer, or control external stimulation continuously toward a target activity rate, retaining neural state while measured activity streams to the interface (bounded paired experiments remain available). Exact decisions, applied settings and measured outcomes are logged; a Stop button ends control. Two-organism mode runs independent brain states with identical wiring; their local LLM controllers exchange logged messages and choose their own input rates. Pause communication or inspect either brain from its card. The page also opens in VS Code's integrated browser. The default physical-world mode runs without an LLM: two FlyWire networks receive chemical/contact proxies and drive articulated virtual bodies through food, obstacles and collisions, using an explicit experimental motor adapter. Setup, data provenance, scientific limits and run instructions are in [brain/README.md](brain/README.md). This experiment is separate from the ecological neural controllers and from the male CNS dataset.

## Development roadmap

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the roadmap, including richer ecology, neural evolution, reproducible experiments, dependencies, and acceptance criteria. The phase tracker records what is implemented and verified.

## Implemented foundation (P00)

The preserved legacy behavior is documented in [MODEL_SPEC.md](docs/MODEL_SPEC.md), with exact defaults and units in [PARAMETERS.md](docs/PARAMETERS.md). See [implementation status](docs/IMPLEMENTATION_STATUS.md) for verified work and the next phase.

Run `npm test` for validation, boundary cases, inheritance, and exact legacy trajectory checks. Tests use Node's built-in test runner; no test framework or runtime npm packages are required. The recorded baseline runtime is Node 23.11.0 (see fixture metadata). Other runtimes can run the suite, but a numerical/hash difference must be investigated rather than silently overwriting expected results.

`dist/presets/legacy-v1.json` is a validated setup preset. From JavaScript, pass its parsed contents to `Ecosystem.fromConfig(config)`; there is not yet an import/preset UI. Existing constructor calls remain supported for valid seeds/architectures. Invalid configurations now throw clear errors instead of being rounded or clamped. World dimensions and founder counts remain fixed in this model version.

`npm run benchmark:legacy` measures three seeded headless scenarios. The P00 result is recorded in [P00_BENCHMARK.json](docs/P00_BENCHMARK.json); it does not measure browser frame rate.

`npm run benchmark:predator` measures rule, neural and dense-cluster 2D workloads. The current result is [PREDATOR_V2_BENCHMARK.json](docs/PREDATOR_V2_BENCHMARK.json). This is headless Node throughput, not browser frame rate.
