import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, appendFile, readFile } from "node:fs/promises";
import { numberInRange } from "../dist/sim/config.js";

function argumentsFor(argv) {
  const values = {};
  const keys = ["runs", "workers", "ticks", "prey", "predators", "food", "width", "height",
    "networks", "depth", "brain-width", "seed", "out", "config"];
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (!argv[i]?.startsWith("--") || !keys.includes(key) || !argv[i + 1]) throw new Error(`Invalid argument: ${argv[i]}`);
    values[key] = argv[i + 1];
  }
  return values;
}
export async function runExperiments(argv = process.argv.slice(2)) {
  const args = argumentsFor(argv);
  const n = (key, fallback, min, max) => numberInRange(Number(args[key] ?? fallback), key, min, max, true);
  const runs = n("runs", 4, 1, 10000), workers = n("workers", Math.min(4, Math.max(1, availableParallelism() - 1)), 1, 64);
  const ticks = n("ticks", 1800, 1, 1000000000), seed = n("seed", 90210, 0, 0xffffffff - runs + 1);
  const directory = resolve(args.out ?? `simulation-results/batch-${Date.now()}`);
  const config = args.config ? JSON.parse(await readFile(resolve(args.config), "utf8")) : {
    width: n("width", 1200, 250, 100000), height: n("height", 800, 250, 100000),
    prey: n("prey", 80, 0, 100000), predators: n("predators", 8, 0, 100000),
    food: n("food", 230, 0, 100000),
    neural: { count: n("networks", 1, 1, 4), depth: n("depth", 2, 1, 3), width: n("brain-width", 8, 2, 12) },
    budgets: { organisms: 100000, food: 100000, carcasses: 100000 },
  };
  await mkdir(directory, { recursive: true });
  const manifest = { startedAt: new Date().toISOString(), node: process.version, runs,
    workers: Math.min(workers, runs), ticks, firstSeed: seed, config };
  await writeFile(resolve(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
  let next = 0, completed = 0;
  const active = new Set(), results = [];
  async function lane() {
    while (next < runs) {
      const index = next++, runSeed = seed + index;
      const result = await new Promise((resolveRun, reject) => {
        const worker = new Worker(new URL("./experiment-worker.mjs", import.meta.url), {
          workerData: { config: { ...config, seed: runSeed }, ticks,
            outputDirectory: resolve(directory, `run-${String(index + 1).padStart(4, "0")}`) },
        });
        active.add(worker);
        let done = false;
        worker.on("message", (message) => {
          if (message.complete) { done = true; resolveRun(message.result); }
        });
        worker.on("error", reject);
        worker.on("exit", (code) => {
          active.delete(worker);
          if (!done) reject(new Error(`Experiment ${index + 1} stopped (exit ${code})`));
        });
      });
      results.push(result);
      await appendFile(resolve(directory, "results.ndjson"), JSON.stringify(result) + "\n");
      console.log(`${++completed}/${runs} · seed ${runSeed} · ${result.tick} ticks · ${result.ticksPerSecond.toFixed(1)} ticks/s${result.technicalLimit ? " · technical limit reached" : ""}`);
    }
  }
  try { await Promise.all(Array.from({ length: Math.min(workers, runs) }, lane)); }
  finally { await Promise.all([...active].map((worker) => worker.terminate())); }
  console.log(`Saved metrics and complete neural checkpoints to ${directory}`);
  return { directory, results };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runExperiments().catch((error) => { console.error(error.message); process.exitCode = 1; });
