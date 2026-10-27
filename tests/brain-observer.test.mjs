import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { BrainObserverService, OBSERVER_MODEL, observerContext, observerRequest } from "../scripts/brain-observer-service.mjs";
import { BrainObserverController } from "../dist/brain-observer.js";
import { createLocalServer } from "../scripts/local-server.mjs";

const recording = JSON.parse(await readFile(new URL("../dist/data/brain-lab-reference.json", import.meta.url), "utf8"));
const selection = { resultId: "reference-200ms", condition: "sugar", neuronId: recording.nodes[0].id };
const readRecording = async () => ({ resultId: "reference-200ms", recording });
const tags = () => Response.json({ models: [{ name: OBSERVER_MODEL }] });
const reply = (text = "The intact circuit propagated activity downstream.") => Response.json({ message: { content: text } });

test("observer context uses recorded settings and preserves absent body state", () => {
  const before = JSON.stringify(recording);
  const context = observerContext(recording, selection.resultId, selection);
  assert.equal(context.parameters.effective_stimulation_hz, 150);
  assert.equal(context.recorded_counts.downstream_spikes, 2008);
  assert.equal(context.paired_comparison.disconnected_downstream_spikes, 0);
  assert.equal(context.selected_neuron.flywire_id, recording.nodes[0].id);
  assert(context.unavailable_information.includes("hunger"));
  assert.equal(context.control_authority, "none; read-only observer");
  assert.equal(observerContext(recording, selection.resultId, { ...selection, condition: "baseline" }).parameters.effective_stimulation_hz, 0);
  const request = observerRequest(context);
  assert.equal(request.model, OBSERVER_MODEL);
  assert.equal(request.tools, undefined);
  assert.deepEqual(JSON.parse(request.messages[1].content.split("\n")[1]), context);
  assert.equal(JSON.stringify(recording), before);
  for (const value of [{ ...selection, action: "stimulate" }, { ...selection, rate_hz: 250 },
    { ...selection, condition: "__proto__" }, { ...selection, neuronId: "1" }, { ...selection, resultId: "stale" }])
    assert.throws(() => observerContext(recording, selection.resultId, value));
});

test("local observer logs its exact input and output, restores them and never changes neural data", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "brain-observer-")), auditFile = resolve(root, "log.ndjson");
  const before = JSON.stringify(recording);
  let sent;
  const fetcher = async (url, options) => {
    assert(url.startsWith("http://127.0.0.1:11434/"));
    if (url.endsWith("tags")) return tags();
    sent = JSON.parse(options.body);
    return reply("<script>example</script> The circuit emitted 2008 downstream spikes.");
  };
  const service = new BrainObserverService(readRecording, fetcher, { auditFile });
  try {
    const entry = await service.observe(selection);
    assert.equal(entry.status, "complete"); assert(entry.completedAt);
    assert.deepEqual(entry.request, sent);
    assert.equal(entry.commentary, "<script>example</script> The circuit emitted 2008 downstream spikes.");
    assert.equal(JSON.stringify(recording), before);
    const disk = JSON.parse((await readFile(auditFile, "utf8")).trim());
    assert.deepEqual(disk.request, sent);
    assert.equal(disk.contextHash, entry.contextHash);
    const restored = new BrainObserverService(readRecording, fetcher, { auditFile });
    assert.equal((await restored.log()).entries[0].commentary, entry.commentary);
    await restored.close();
  } finally { await service.close(); await rm(root, { recursive: true, force: true }); }
});

test("busy and cancelled observer calls stay independent of the neural model", async () => {
  let signal;
  const fetcher = async (url, options) => {
    if (url.endsWith("tags")) return tags();
    signal = options.signal;
    return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  };
  const service = new BrainObserverService(readRecording, fetcher);
  const pending = service.observe(selection);
  const rejected = assert.rejects(pending, /cancelled/);
  await assert.rejects(service.observe(selection), /already generating/);
  while (!signal) await new Promise((done) => setImmediate(done));
  await service.cancel(); await rejected;
  assert(signal.aborted);
  assert.equal((await service.log()).entries[0].status, "cancelled");
  assert.equal(service.busy, false);
  await service.close();
});

test("offline, empty and timed-out model replies produce inspectable failure entries", async () => {
  const offline = new BrainObserverService(readRecording, async () => { throw new Error("offline"); });
  await assert.rejects(offline.observe(selection), /Start Ollama/);
  assert.equal((await offline.log()).entries[0].status, "failed"); await offline.close();
  const empty = new BrainObserverService(readRecording, async (url) => url.endsWith("tags") ? tags() : reply(""));
  await assert.rejects(empty.observe(selection), /empty commentary/); await empty.close();
  const timed = new BrainObserverService(readRecording, async (url, options) => {
    if (url.endsWith("tags")) return tags();
    return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  }, { timeoutMs: 15 });
  // Keep the test event loop alive while AbortSignal's unref'ed timer expires.
  const hold = setInterval(() => {}, 1000);
  try { await assert.rejects(timed.observe(selection), /timed out/); }
  finally { clearInterval(hold); await timed.close(); }
});

test("changing selection never relabels a late LLM reply; automatic observation is opt-in", async () => {
  let resolveReply, calls = 0, entries = [];
  const controller = new BrainObserverController(async (path, body) => {
    if (path === "observer/status") return { available: true, busy: false };
    if (path === "observer/log") return { entries };
    calls++;
    return new Promise((resolve) => { resolveReply = () => {
      const entry = { ...body, id: String(calls), status: "complete", commentary: "Original selection" };
      entries = [entry, ...entries]; resolve(entry);
    }; });
  });
  controller.select(selection, true); await controller.check();
  assert.equal(calls, 0);
  const pending = controller.explain();
  controller.select({ ...selection, condition: "baseline" });
  resolveReply(); await pending;
  assert.equal(controller.current, null);
  assert.equal(controller.entries[0].condition, "sugar");
  controller.select(selection);
  assert.equal(controller.current.commentary, "Original selection");
  controller.enable(true); assert.equal(calls, 1); // reuse the matching completed entry
});

test("HTTP observer reads server-owned facts, rejects control payloads and enforces localhost origins", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "brain-observer-http-"));
  const server = createLocalServer(async (url) => url.endsWith("tags") ? tags() : reply(), {
    dataDirectory: resolve(root, "ecology"), brainLab: { brainRoot: resolve(root, "brain") },
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, origin) => fetch(base + "/api/brain/observer/observe", { method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
  try {
    const before = JSON.stringify((await (await fetch(base + "/api/brain/result")).json()).recording);
    assert.equal((await post(selection, "https://external.example")).status, 403);
    assert.equal((await post({ ...selection, action: "set_weights" })).status, 400);
    const response = await post(selection); assert.equal(response.status, 200);
    const entry = await response.json(); assert.equal(entry.context.recorded_counts.downstream_spikes, 2008);
    assert.equal(JSON.stringify((await (await fetch(base + "/api/brain/result")).json()).recording), before);
    assert.equal((await (await fetch(base + "/api/brain/status")).json()).jobId, null);
    const log = await (await fetch(base + "/api/brain/observer/log")).json();
    assert.equal(log.entries[0].id, entry.id);
  } finally {
    await server.brainObserver.close(); await server.brainLab.close();
    await new Promise((done) => server.close(done)); await rm(root, { recursive: true, force: true });
  }
});
