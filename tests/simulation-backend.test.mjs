import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createLocalServer } from "../scripts/local-server.mjs";
import { PredatorWorld } from "../dist/sim/predator-world.js";
import { EvolvingWorld } from "../dist/sim/evolving-world.js";
import { controlSnapshot } from "../scripts/simulation-snapshot.mjs";
import { runExperiments } from "../scripts/run-experiments.mjs";
import { SimulationService } from "../scripts/simulation-service.mjs";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "primordial-backend-"));
  const server = createLocalServer(fetch, { dataDirectory: directory });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (action, payload = {}) => {
    const response = await fetch(base + "/api/simulation", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ action, payload }) });
    const result = await response.json();
    assert.equal(response.status, 200, result.error);
    return result;
  };
  return { directory, server, base, request, async close() {
    await server.simulation.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  } };
}
test("local worker progresses without a browser, pauses exactly, and continues a neural checkpoint deterministically", async () => {
  const f = await fixture();
  try {
    await f.request("restart", { neural: { count: 1, depth: 1, width: 6 }, prey: 50, predators: 2 });
    const initial = await f.request("playback", { paused: true });
    const saved = await f.request("checkpoint");
    const before = JSON.parse(await readFile(join(f.directory, saved.result.name), "utf8"));
    await delay(100);
    assert.equal((await f.request("playback", { paused: true })).snapshot.tick, initial.snapshot.tick);
    await f.request("playback", { speed: "max", paused: false });
    // No UI, frame callbacks or snapshot requests drive these ticks.
    await delay(150);
    const after = await f.request("playback", { paused: true });
    assert(after.snapshot.tick > initial.snapshot.tick);
    const savedAfter = await f.request("checkpoint");
    const end = JSON.parse(await readFile(join(f.directory, savedAfter.result.name), "utf8"));
    const reference = EvolvingWorld.restore(before.state);
    while (reference.tick < end.state.tick) reference.stepTick();
    assert.equal(EvolvingWorld.restore(end.state).stateKey(), reference.stateKey());
    const resumed = await f.request("restore", { name: saved.result.name });
    assert.equal(resumed.snapshot.tick, initial.snapshot.tick);
    assert.equal(resumed.snapshot.runtime.paused, true);
    assert.equal(resumed.snapshot.neural.count, 1);
    assert((await f.request("checkpoints")).result.length >= 3);
  } finally { await f.close(); }
});
test("large controls are responsive, previews stay bounded, and rejected edits leave the paused world intact", async () => {
  const f = await fixture();
  try {
    await f.request("playback", { paused: true });
    const updated = await f.request("settings", { width: 12000, height: 12000, prey: 2000, predators: 100, food: 12000 });
    assert.equal(updated.snapshot.metrics.population, 2100);
    assert.equal(updated.snapshot.organisms.length, 1200);
    assert.equal(updated.snapshot.food.length, 2500);
    assert.equal(updated.snapshot.viewSampled, true);
    const hidden = await (await fetch(f.base + "/api/simulation?view=0")).json();
    assert.equal(hidden.snapshot.organisms.length, 0);
    assert.equal(hidden.snapshot.metrics.population, 2100);
    const inspection = await f.request("inspect", { role: "predator" });
    assert.equal(inspection.snapshot.selected.role, "predator");
    const response = await fetch(f.base + "/api/simulation", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "settings", payload: { width: 249 } }) });
    assert.equal(response.status, 400);
    const unchanged = await f.request("playback", { paused: true });
    assert.equal(unchanged.snapshot.width, 12000);
    assert.equal(unchanged.snapshot.tick, updated.snapshot.tick);
    await f.request("playback", { speed: "max", paused: false });
    await delay(100);
    const started = performance.now();
    assert.equal((await fetch(f.base + "/index.html")).status, 200);
    assert(performance.now() - started < 1500, "HTTP server must remain responsive during CPU work");
    await delay(1000);
    assert((await readdir(f.directory)).some((name) => name.endsWith(".ndjson")));
    assert.equal((await fetch(f.base + "/api/simulation", { method: "POST", headers: { origin: "https://example.com" }, body: "{}" })).status, 403);
    await assert.rejects(f.server.simulation.request("restore", { name: "../package.json" }), /Invalid checkpoint/);
  } finally { await f.close(); }
});
test("inspection and sampled snapshots are read-only and send no unselected genomes", () => {
  const world = new PredatorWorld(17, { count: 1, depth: 1, width: 6 }, 1, { prey: 3 });
  world.stepTick();
  const before = world.stateKey();
  const snapshot = controlSnapshot(world, {}, { selectedId: world.organisms[0].id });
  assert(snapshot.selected.traces.length);
  assert(snapshot.organisms.every((o) => !o.brains));
  assert.equal(world.stateKey(), before);
});

test("a fresh service restores the latest disk state paused after a clean server shutdown", async () => {
  const directory = await mkdtemp(join(tmpdir(), "primordial-restart-"));
  const first = new SimulationService(directory);
  let second;
  try {
    await first.request("restart", { prey: 40, predators: 4, neural: { count: 2, depth: 1, width: 6 } });
    await delay(100);
    const before = (await first.request("playback", { paused: true, speed: 3 })).snapshot;
    await first.close();
    second = new SimulationService(directory);
    const after = (await second.request("snapshot")).snapshot;
    assert.equal(after.tick, before.tick);
    assert.equal(after.runtime.runId, before.runtime.runId);
    assert.equal(after.runtime.speed, 3);
    assert.equal(after.runtime.paused, true);
    assert.deepEqual(after.metrics, before.metrics);
    assert.equal(after.neural.count, 2);
  } finally {
    await first.close();
    await second?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("parallel batch jobs save independent metrics and complete checkpoints without a web server", async () => {
  const directory = await mkdtemp(join(tmpdir(), "primordial-batch-"));
  try {
    const batch = await runExperiments(["--runs", "2", "--workers", "2", "--ticks", "30", "--prey", "20",
      "--predators", "2", "--food", "100", "--out", directory]);
    assert.deepEqual(batch.results.map((r) => r.seed).sort(), [90210, 90211]);
    assert(batch.results.every((r) => r.tick === 30 && Math.abs(r.energyResidual) < 1e-6));
    assert.equal((await readFile(join(directory, "results.ndjson"), "utf8")).trim().split("\n").length, 2);
    for (const [i, seed] of [90210, 90211].entries()) {
      const folder = join(directory, `run-${String(i + 1).padStart(4, "0")}`);
      const envelope = JSON.parse(await readFile(join(folder, "latest.json"), "utf8"));
      const replay = new EvolvingWorld(seed, envelope.state.neural, 2, { prey: 20, food: 100, width: 1200,
        height: 800, budgets: { organisms: 100000, food: 100000, carcasses: 100000 } });
      for (let tick = 0; tick < 30; tick++) replay.stepTick();
      assert.equal(EvolvingWorld.restore(envelope.state).stateKey(), replay.stateKey());
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("headless neural learning records real artwork and restores both experience and paths", async () => {
  const f = await fixture();
  try {
    const initial = await f.request("playback", { paused: false, speed: "max" });
    assert.equal(initial.snapshot.neural.count, 1);
    assert.equal(initial.snapshot.modelVersion, "predator-v3");
    await delay(200);
    const paused = await f.request("playback", { paused: true });
    assert(paused.snapshot.metrics.intelligence.totalUpdates > 0);
    const art = await f.request("artSnapshot");
    assert(art.result.segments.length > 0);
    const saved = await f.request("checkpoint");
    const svg = await f.request("artExport", { theme: "ember" });
    assert.match(svg.result.svg, /Actual recorded movement/);
    assert.equal(svg.snapshot.tick, paused.snapshot.tick);
    await f.request("restart");
    const restored = await f.request("restore", { name: saved.result.name });
    assert.equal(restored.snapshot.metrics.intelligence.totalUpdates, paused.snapshot.metrics.intelligence.totalUpdates);
    const restoredArt = await f.request("artSnapshot");
    assert.deepEqual(restoredArt.result.segments, art.result.segments);
    const rejected = await fetch(f.base + "/api/simulation", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "restart", payload: { neural: { count: 0, depth: 1, width: 6 } } }) });
    assert.equal(rejected.status, 400);
  } finally { await f.close(); }
});
