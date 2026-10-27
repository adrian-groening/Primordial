# Local simulation engine

The default 2D ecosystem runs in a dedicated Node.js worker thread on your computer. The browser sends commands and receives bounded snapshots; it does not step the model. Rendering, browser frame rate, tab visibility, and closing the tab do not control simulation time. Keep the local server running. Computer sleep and stopping the server stop execution.

## Start and control a run

```sh
npm start
```

Open `http://127.0.0.1:4173`. The 2D panel requires this local server; a static website host does not provide its compute engine. The first connection starts a small ecosystem with neural networks and lifetime learning. See [EVOLVING_MINDS.md](EVOLVING_MINDS.md). If a latest checkpoint exists, the engine restores it **paused**; press Play to continue. The local server binds to loopback. The 3D planet remains a separate browser prototype.

- **Pause / Play:** stop or continue the actual engine, independently of the viewer.
- **1× / 3× / 8×:** request 30 / 90 / 240 model ticks per wall-clock second. Actual speed is shown; processing may fall below the requested rate. A late engine catches up by at most one wall-clock second.
- **Max:** advance as quickly as CPU and model work permit. The engine yields between batches to accept controls. A single expensive tick or large edit can still delay a worker response; the HTTP server and browser remain separate.
- **Close-up view / Fit world:** switch between a local view where animal movement is visible and an overview of the entire ecosystem. Large worlds initially open at a close scale. Follow selected centers the camera on the chosen animal.
- **Turn visualization off:** receive metrics and selected-organism details without entity positions. This reduces transfer and rendering work while every organism continues simulating.
- **Apply large ecosystem preset:** expand to 12,000 × 12,000 LU, set 2,000 prey, 100 predators and 12,000 food items, and apply one width-6 neural network per organism. Existing organisms and simulation time are retained. It is a workload preset, not a guarantee of ecological stability.
- **Save checkpoint / Restore & pause:** store complete world state, including neural genomes, RNG streams, pending commands, and technical-limit diagnostics, then restore a selected save.

Metrics always cover the full population. The visual sample has at most 1,200 organisms, 2,500 food items, and 1,200 carcasses. The selected organism is included in that sample when visualization is on. Preview identities are retained between updates so population changes do not swap most visible animals. The panel fetches positions at up to 10 Hz and interpolates between confirmed snapshots on animation frames; it never extrapolates or advances model time. A small adaptive display delay smooths motion. Pause, restore, resize and re-enabling the preview clear stale interpolation. Only the selected organism's neural weights and activation trace are sent. The inspector buttons cycle through the full population, including organisms omitted from the preview. The history chart retains the latest 120 model-second samples; the disk record continues independently.

Dimensions and requested prey, predator and food counts now validate up to 100,000. These are configuration ceilings, **not a tested real-time capacity**. Technical budgets still protect memory and preserve rejected-tick rollback. An impossible crowded placement fails atomically. Increasing density and brain size raises work. Near-budget ticks still copy full state for transactional rollback.

## Disk records and restart

Records live in `.simulation-data/` (excluded from Git). Set `EVOLUTION_DATA_DIR` to choose another folder and `EVOLUTION_PORT` to choose another port.

- `metrics-<run-id>.ndjson`: streamed metrics at most once per wall-clock second, skipping unchanged paused states; does not retain a growing metrics array in RAM.
- `latest.json`: complete checkpoint saved every wall-clock minute and on clean `Ctrl+C` / SIGTERM shutdown. A crash may lose progress since the last save.
- `checkpoint-<timestamp-and-id>.json`: a retained manual checkpoint.

Manual checkpoints and metric files are retained until you remove them. Autosave replaces only `latest.json` atomically. Saving/serialization temporarily uses memory proportional to the full world. There is no automatic disk retention policy yet.

The default run budgets are 10,000 organisms, 100,000 food items and 20,000 carcasses. Hitting a budget pauses the model; raise the affected budget to resume the same rejected tick. Reloading the page reconnects to the running worker. Restarting the server restores the latest checkpoint and waits for Play.

## Run experiments without any browser

```sh
npm run simulate -- --runs 4 --workers 4 --ticks 1800
```

This runs four independent seeded experiments using up to four CPU workers. Defaults are 80 prey, 8 predators, 230 food items, a 1,200 × 800 world and one two-layer width-8 neural network per organism, with 100,000-item technical budgets. Each experiment simulates 1,800 ticks (60 model seconds), unless a technical limit is reached. Output goes to a new `simulation-results/batch-<timestamp>/` folder.

```sh
npm run simulate -- --runs 8 --workers 4 --ticks 9000 --prey 10000 --predators 500 --food 60000 --width 27000 --height 27000 --networks 1 --out simulation-results/large-study
```

Options: `--runs`, `--workers`, `--ticks`, `--seed`, `--prey`, `--predators`, `--food`, `--width`, `--height`, `--networks`, `--depth`, `--brain-width`, `--out`, and `--config`. Use a fresh output folder for each batch. `--config` accepts a JSON object containing the constructor settings, `neural`, `predators`, `renewal` and `mutation`; it replaces the built-in world configuration. Run seeds are assigned by `--seed` and incremented per experiment.

Each batch writes its configuration to `manifest.json`, final results to `results.ndjson`, and a subfolder per run containing metrics every 300 model ticks, recorded paths, `motion-art.svg` and complete final checkpoints. Parallelism is **across independent experiments**. One world currently advances on one CPU worker; it does not partition its interacting population across cores or use a GPU. A batch checkpoint can be inspected in the panel by copying its retained `checkpoint-*.json` into the local data folder and refreshing Saved runs.

## Scale validation

Run `npm run benchmark:scale`. [LOCAL_ENGINE_BENCHMARK.json](LOCAL_ENGINE_BENCHMARK.json) records a short headless test on Apple M3 Pro, Node v23.11.0, with one width-6 hidden layer per animal:

- 2,100 starting animals and 12,000 food items: about 71 ticks/s across 120 ticks.
- 10,500 starting animals and 60,000 food items: about 11 ticks/s across 60 ticks.

The model uses 30 ticks per simulated second. These are short CPU-throughput measurements, not long-run stability, maximum-capacity, or browser-FPS guarantees. JavaScript heap measurements include transient allocations.

The moving-body grid is updated after each mover, so later animals see the same positions as with a full-body scan. Differential tests compare indexed and full-scan trajectories through reproduction and both boundary modes. Other tests cover independent worker progress, exact pause, checkpoint replay against the synchronous model, rejected edits, bounded/no-visualization snapshots, selected inspection, and parallel batch output. Real Chrome interaction checks cover the large preset, Max speed, visualization off/on, checkpoint save/restore, narrow-screen overflow, and continued progress after closing the tab.

The active model now includes lifetime learning, recurrent memory, evolving ability genes and motion artwork; see [EVOLVING_MINDS.md](EVOLVING_MINDS.md). The scale benchmark above characterizes the earlier predator-v2 model; use `npm run benchmark:learning` for current default-model throughput. Broader ecological features, ancestry tracking and long-horizon intelligence evaluation remain future work.
