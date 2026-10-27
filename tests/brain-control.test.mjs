import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BrainLabService } from "../scripts/brain-lab-service.mjs";
import { BrainControlService, parseControlDecision, validateControlSettings, measuredActivity } from "../scripts/brain-control-service.mjs";
import { createLocalServer } from "../scripts/local-server.mjs";

const recordingPath = new URL("../dist/data/brain-lab-reference.json", import.meta.url);
const recording = JSON.parse(await readFile(recordingPath, "utf8"));
const settings = { resultId: "reference-200ms", target_spikes_per_second: 5000, duration_ms: 200, seed: 42, rounds: 3 };
const reply = (decision) => Response.json({ message: { content: typeof decision === "string" ? decision : JSON.stringify(decision) } });
const action = (rate_hz) => ({ rate_hz, rationale: "Test this input against the measured target." });
const tick = () => new Promise((done) => setImmediate(done));

async function fixture(fetcher, options = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "brain-control-")), runner = resolve(root, "runner.cjs");
  await writeFile(runner, `
    const fs = require('node:fs/promises');
    const args = Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+i*2],process.argv[3+i*2]]));
    const rate = Number(args['--rate-hz']);
    if (rate === 175) { console.error('controlled brain failure'); process.exit(3); }
    if (rate === 200) setInterval(()=>{},1000);
    else setTimeout(async()=>{
      const data = JSON.parse(await fs.readFile(${JSON.stringify(fileURLToPath(recordingPath))},'utf8'));
      data.rate_hz = rate; data.seed = Number(args['--seed']); data.duration_ms = Number(args['--duration-ms']);
      const trial = data.conditions.find(t=>t.key==='sugar');
      trial.downstream_spikes = rate * 10; trial.total_spikes = trial.input_spikes + trial.downstream_spikes;
      await fs.mkdir(args['--output'],{recursive:true});
      await fs.writeFile(args['--output']+'/playback.json',JSON.stringify(data));
    },25);
  `);
  const brainOptions = { brainRoot: root, python: process.execPath, runner, referenceFiles: [], defaultResult: recordingPath };
  const brain = new BrainLabService(brainOptions); await brain.ready;
  const controller = new BrainControlService(brain, fetcher, { auditFile: resolve(root, "controller.json"), ...options });
  await controller.ready;
  return { root, brain, brainOptions, controller,
    async close() { await controller.close(); await brain.close(); await rm(root, { recursive: true, force: true }); } };
}

test("control accepts only a bounded session and a strict stimulation decision", () => {
  assert.deepEqual(validateControlSettings(settings), settings);
  for (const input of [null, [], {}, { ...settings, rounds: 0 }, { ...settings, rounds: 6 },
    { ...settings, duration_ms: 99 }, { ...settings, target_spikes_per_second: -1 },
    { ...settings, target_spikes_per_second: 100001 }, { ...settings, seed: -1 },
    { ...settings, resultId: "" }, { ...settings, rate_hz: 999 }]) assert.throws(() => validateControlSettings(input));
  assert.deepEqual(parseControlDecision(JSON.stringify(action(125))), action(125));
  for (const input of ["words", "```json\n{}\n```", "null", "[]", "{}", JSON.stringify(action(251)),
    JSON.stringify(action(24)), JSON.stringify(action("100")), JSON.stringify(action(100.2)),
    JSON.stringify({ ...action(100), code: "run()" }), JSON.stringify({ rate_hz: 100, rationale: "" })])
    assert.throws(() => parseControlDecision(input), /nothing was applied/);
  assert.equal(measuredActivity(recording, "ref").downstream_spikes_per_second, 10040);
});

test("LLM decisions launch the real runner interface and feed measured results into the next decision", async () => {
  const requests = [], rates = [150, 100];
  const f = await fixture(async (url, options) => {
    assert.equal(url, "http://127.0.0.1:11434/api/chat");
    requests.push(JSON.parse(options.body));
    return reply(action(rates.shift()));
  });
  try {
    const initialRecording = JSON.stringify(f.brain.result);
    const started = await f.controller.start(settings);
    assert.equal(started.active, true);
    assert.equal(f.brain.controlOwner, started.session.id);
    await assert.rejects(f.brain.run({ rate_hz: 150, duration_ms: 200, seed: 42 }), /LLM control owns/);
    await assert.rejects(f.brain.cancel(), /LLM control owns/);
    await assert.rejects(f.controller.start(settings), /already running/);
    await f.controller.completion;
    const { session, active } = await f.controller.status();
    assert.equal(active, false); assert.equal(f.brain.controlOwner, null);
    assert.equal(session.state, "complete"); assert.match(session.reason, /Target reached/);
    assert.equal(session.steps.length, 2); assert.equal(requests.length, 2);
    assert.equal(JSON.parse(requests[1].messages[1].content).target_downstream_spikes_per_second, 5000);
    assert.equal(JSON.parse(requests[1].messages[1].content).measured_activity_is, "ABOVE target");
    assert.equal(JSON.parse(requests[1].messages[1].content).latest_measurement.downstream_spikes_per_second, 7500);
    assert.deepEqual(JSON.parse(requests[1].messages[1].content).prior_rounds, [{ rate_hz: 150, downstream_spikes_per_second: 7500 }]);
    assert.equal(session.steps[1].outcome.downstream_spikes_per_second, 5000);
    assert.equal(session.steps[1].targetError, 0);
    assert.equal(session.steps[1].jobId, f.brain.resultId);
    assert.deepEqual(session.steps[1].appliedSettings, { rate_hz: 100, duration_ms: 200, seed: 42 });
    assert.notEqual(JSON.stringify(f.brain.result), initialRecording);
    const disk = JSON.parse(await readFile(resolve(f.root, "controller.json"), "utf8"));
    assert.deepEqual(disk.sessions[0], session);
    const restored = new BrainControlService(f.brain, fetch, { auditFile: resolve(f.root, "controller.json") });
    assert.equal((await restored.status()).session.steps[1].outcome.resultId, f.brain.resultId);
    assert.equal((await restored.status()).active, false); await restored.close();
  } finally { await f.close(); }
});

test("invalid LLM actions are logged and never run; unreachable targets stop at the budget", async () => {
  const f = await fixture(async () => reply({ ...action(100), weights: [1, 2] }));
  try {
    await f.controller.start(settings); await f.controller.completion;
    let state = (await f.controller.status()).session;
    assert.equal(state.state, "failed"); assert.match(state.error, /unsupported decision/);
    assert.match(state.steps[0].rawReply, /weights/);
    assert.equal(state.steps[0].jobId, null); assert.equal(f.brain.jobId, undefined);
    assert.equal(f.brain.controlOwner, null);
    f.controller.fetcher = async () => reply(action(25));
    await f.controller.start({ ...settings, target_spikes_per_second: 100000, rounds: 2 });
    await f.controller.completion;
    state = (await f.controller.status()).session;
    assert.equal(state.steps.length, 2); assert.match(state.reason, /not reached/);
    assert.equal(state.state, "complete");
  } finally { await f.close(); }
});

test("Stop cancels LLM inference without launching a brain and releases manual control", async () => {
  let signal;
  const f = await fixture(async (url, options) => {
    signal = options.signal;
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  try {
    await f.controller.start(settings);
    while (!signal) await tick();
    await f.controller.cancel();
    assert(signal.aborted); assert.equal(f.brain.jobId, undefined);
    assert.equal((await f.controller.status()).session.state, "cancelled");
    await f.brain.run({ rate_hz: 100, duration_ms: 200, seed: 42 }); await f.brain.completion;
    assert.equal(f.brain.state, "complete");
  } finally { await f.close(); }
});

test("a failed neural run cannot become feedback or launch another control round", async () => {
  let calls = 0;
  const f = await fixture(async () => { calls++; return reply(action(175)); });
  try {
    await f.controller.start(settings); await f.controller.completion;
    const session = (await f.controller.status()).session;
    assert.equal(session.state, "failed"); assert.match(session.error, /controlled brain failure/);
    assert.equal(calls, 1); assert.equal(session.steps[0].outcome, null);
    assert.equal(f.brain.resultId, "reference-200ms"); assert.equal(f.brain.controlOwner, null);
  } finally { await f.close(); }
});

test("Stop terminates the owned running brain job and retains the previous recording", async () => {
  const f = await fixture(async () => reply(action(200)));
  try {
    await f.controller.start(settings);
    while (!f.brain.child) await tick();
    await f.controller.cancel();
    assert.equal(f.brain.child, null); assert.equal(f.brain.resultId, "reference-200ms");
    assert.equal((await f.controller.status()).session.state, "cancelled");
    assert.equal(f.brain.controlOwner, null);
  } finally { await f.close(); }
});

test("cancellation while checking model availability cannot spawn a late orphan job", async () => {
  const f = await fixture(async () => reply(action(100)));
  let release, checking = false;
  const gate = new Promise((done) => { release = done; });
  f.brain.available = async () => { checking = true; return gate; };
  try {
    await f.controller.start(settings);
    while (!checking) await tick();
    const cancelled = f.controller.cancel();
    release(true); await cancelled;
    assert.equal(f.brain.jobId, undefined); assert.equal(f.brain.child, null);
    assert.equal((await f.controller.status()).session.state, "cancelled");
  } finally { await f.close(); }
});

test("offline/timeout/error outcomes stop control; interrupted logs never auto-resume", async () => {
  const f = await fixture(async () => { throw new Error("offline"); });
  try {
    await f.controller.start(settings); await f.controller.completion;
    assert.equal((await f.controller.status()).session.state, "failed");
    assert.equal(f.brain.controlOwner, null);
    f.controller.timeoutMs = 15;
    f.controller.fetcher = async (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    const hold = setInterval(() => {}, 1000);
    try {
      await f.controller.start(settings); await f.controller.completion;
      assert.match((await f.controller.status()).session.error, /timed out/);
    } finally { clearInterval(hold); }
    const auditFile = resolve(f.root, "interrupted.json");
    await writeFile(auditFile, JSON.stringify({ schema: "brain-control-v1", sessions: [{ id: "prior", state: "running" }] }));
    const restored = new BrainControlService(f.brain, fetch, { auditFile });
    const state = await restored.status(); assert.equal(state.session.state, "interrupted");
    assert.equal(state.active, false); assert.equal(f.brain.controlOwner, null); await restored.close();
  } finally { await f.close(); }
});

test("manual jobs already past readiness cannot overtake an acquired control lease", async () => {
  const f = await fixture(async () => reply(action(100)));
  const available = f.brain.available.bind(f.brain);
  let release, checking = false;
  f.brain.available = async () => { checking = true; return new Promise((done) => { release = done; }); };
  try {
    const pending = f.brain.run({ rate_hz: 150, duration_ms: 200, seed: 42 });
    const rejected = assert.rejects(pending, /LLM control owns/);
    while (!checking) await tick();
    f.brain.acquireControl("lease"); release(true); await rejected;
    assert.equal(f.brain.child, null); f.brain.releaseControl("lease");
  } finally { f.brain.available = available; await f.close(); }
});

test("HTTP control enforces origins, stale snapshots and supported settings, then applies a decision", async () => {
  const f = await fixture(async () => reply(action(100)));
  const server = createLocalServer(async () => reply(action(100)), {
    dataDirectory: resolve(f.root, "ecology"), brainLab: f.brainOptions,
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (value, origin) => fetch(base + "/api/brain/control/start", { method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(value) });
  try {
    assert.equal((await post(settings, "https://external.example")).status, 403);
    assert.equal((await post({ ...settings, resultId: "stale" })).status, 409);
    assert.equal((await post({ ...settings, code: "anything" })).status, 400);
    assert.equal((await post(settings)).status, 202);
    await server.brainControl.completion;
    const state = await (await fetch(base + "/api/brain/control/status")).json();
    assert.equal(state.session.state, "complete"); assert.equal(state.session.steps[0].decision.rate_hz, 100);
    const result = await (await fetch(base + "/api/brain/result")).json();
    assert.equal(result.recording.rate_hz, 100); assert.equal(result.recording.seed, 42);
    assert.equal(result.resultId, state.session.steps[0].outcome.resultId);
  } finally {
    await server.brainControl.close(); await server.brainLab.close(); await server.brainObserver.close();
    await new Promise((done) => server.close(done)); await f.close();
  }
});
