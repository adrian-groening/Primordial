import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BrainLabService, validateBrainSettings } from "../scripts/brain-lab-service.mjs";
import { createLocalServer } from "../scripts/local-server.mjs";
import { validateRecording, comparison, indexSpikeTimes, recentSpike, upperBound } from "../dist/brain-lab-data.js";

const recordingPath = new URL("../dist/data/brain-lab-reference.json", import.meta.url);
const recording = JSON.parse(await readFile(recordingPath, "utf8"));

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "brain-lab-test-"));
  const runner = resolve(root, "worker.cjs");
  await writeFile(runner, `
    const fs = require('node:fs/promises');
    const args = Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+i*2],process.argv[3+i*2]]));
    console.log('Running sugar:');
    if (args['--rate-hz'] === '175') { console.error('controlled failure'); process.exit(3); }
    if (args['--rate-hz'] === '200') { setInterval(()=>{},1000); }
    else setTimeout(async()=>{
      await fs.mkdir(args['--output'],{recursive:true});
      const data = await fs.readFile(${JSON.stringify(fileURLToPath(recordingPath))},'utf8');
      await fs.writeFile(args['--output']+'/playback.json',data);
    },120);
  `);
  const options = { brainRoot: root, python: process.execPath, runner, referenceFiles: [], defaultResult: recordingPath };
  const service = new BrainLabService(options);
  await service.ready;
  return { root, options, service, async close() { await service.close(); await rm(root, { recursive: true, force: true }); } };
}
const settings = { duration_ms: 200, rate_hz: 150, seed: 90210 };

test("recorded reference matches its full-model counters and paired intervention", () => {
  assert.equal(validateRecording(recording), recording);
  assert.equal(recording.neurons, 127400);
  assert.equal(recording.directed_connections, 14687178);
  const { intact, disconnected, reduction } = comparison(recording);
  assert.equal(intact.total_spikes, 2625);
  assert.equal(intact.downstream_spikes, 2008);
  assert.equal(disconnected.input_spikes, intact.input_spikes);
  assert.equal(disconnected.downstream_spikes, 0);
  assert.equal(reduction, 1);
  assert.deepEqual(intact.events, recording.conditions.find((c) => c.key === "sugar_repeat").events);
  assert(recording.nodes.every((node) => typeof node.id === "string"));
  const invalid = structuredClone(recording);
  invalid.conditions[0].events = [[NaN, invalid.nodes[0].index]];
  assert.throws(() => validateRecording(invalid), /spike/);
  const missing = structuredClone(recording); missing.conditions.pop();
  assert.throws(() => validateRecording(missing));
});

test("playback lookup includes the selected instant and never invents an earlier spike", () => {
  const times = indexSpikeTimes({ events: [[1, 5], [2, 7], [5, 5], [5, 5]] });
  assert.deepEqual(times.get(5), [1, 5, 5]);
  assert.equal(upperBound(times.get(5), 5), 3);
  assert.equal(recentSpike(times.get(5), 0), 0);
  assert.equal(recentSpike(times.get(5), 5), 1);
  assert.equal(recentSpike(times.get(5), 9), .5);
  assert.equal(recentSpike(times.get(5), 14), 0);
  assert.equal(recentSpike(undefined, 4), 0);
});

test("local model requests validate types, bounds and extra arguments", () => {
  assert.deepEqual(validateBrainSettings(settings), settings);
  for (const value of [null, [], {}, { ...settings, rate_hz: "150" }, { ...settings, duration_ms: 1001 },
    { ...settings, seed: -1 }, { ...settings, seed: 2**32 }, { ...settings, rate_hz: NaN },
    { ...settings, seed: true }, { ...settings, output: "/tmp/elsewhere" }]) assert.throws(() => validateBrainSettings(value));
});

test("only one brain process runs; completed data survives cancellation and failures", async () => {
  const f = await fixture();
  try {
    const initial = f.service.resultId;
    const pair = await Promise.allSettled([f.service.run(settings), f.service.run(settings)]);
    assert.equal(pair.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(pair.find((r) => r.status === "rejected").reason.status, 409);
    await f.service.completion;
    assert.equal(f.service.state, "complete");
    assert.notEqual(f.service.resultId, initial);
    const completed = f.service.resultId;
    await f.service.run({ ...settings, rate_hz: 175 }); await f.service.completion;
    assert.equal(f.service.state, "failed"); assert.match(f.service.error, /controlled failure/);
    assert.equal(f.service.resultId, completed);
    await f.service.run({ ...settings, rate_hz: 200 }); await f.service.cancel();
    assert.equal(f.service.state, "cancelled"); assert.equal(f.service.resultId, completed);
    assert.equal(f.service.child, null);
    const reloaded = new BrainLabService(f.options); await reloaded.ready;
    assert.equal(reloaded.resultId, completed); await reloaded.close();
  } finally { await f.close(); }
});

test("timed out and unavailable models report recoverable errors", async () => {
  const f = await fixture();
  try {
    f.service.timeoutMs = 30;
    await f.service.run({ ...settings, rate_hz: 200 }); await f.service.completion;
    assert.equal(f.service.state, "failed"); assert.match(f.service.error, /time limit/);
    assert.equal(f.service.resultId, "reference-200ms");
    f.service.python = resolve(f.root, "missing-python");
    assert.equal((await f.service.status()).available, false);
    await assert.rejects(f.service.run(settings), /environment is missing/);
  } finally { await f.close(); }
});

test("HTTP Brain Lab serves real recordings, rejects cross-origin runs and keeps ecosystem available", async () => {
  const f = await fixture();
  const server = createLocalServer(fetch, { dataDirectory: resolve(f.root, "ecology"), brainLab: f.options });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(base + "/brain-lab.html"); assert.equal(page.status, 200);
    assert.match(await page.text(), /Fly brain laboratory/);
    const result = await (await fetch(base + "/api/brain/result")).json();
    assert.equal(result.recording.conditions.find((c) => c.key === "sugar").total_spikes, 2625);
    const command = { method: "POST", headers: { "content-type": "application/json", origin: "https://external.example" }, body: JSON.stringify(settings) };
    assert.equal((await fetch(base + "/api/brain/run", command)).status, 403);
    delete command.headers.origin;
    const start = await fetch(base + "/api/brain/run", command); assert.equal(start.status, 202);
    assert.equal((await fetch(base + "/api/brain/run", command)).status, 409);
    assert.equal((await fetch(base + "/planet.html")).status, 200);
    await server.brainLab.completion;
    assert.equal((await (await fetch(base + "/api/brain/status")).json()).state, "complete");
    command.body = JSON.stringify({ ...settings, script: "arbitrary.py" });
    assert.equal((await fetch(base + "/api/brain/run", command)).status, 400);
  } finally {
    await server.brainLab.close();
    await new Promise((done) => server.close(done)); await f.close();
  }
});
