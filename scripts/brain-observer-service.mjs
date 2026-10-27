import { appendFile, mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";

export const OBSERVER_MODEL = "llama2-uncensored:latest";
const OLLAMA = "http://127.0.0.1:11434";
const CONDITIONS = {
  baseline: "External stimulation is off; the model assumes zero basal firing.",
  sugar: "Sugar-sensing neurons receive Poisson stimulation; outgoing connections are intact.",
  sugar_disconnected: "Same seeded stimulation as intact, but outgoing sensor weights are zero.",
  sugar_repeat: "Intact condition repeated from the same initial state and random seed.",
};
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function validateObservationRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !["resultId", "condition", "neuronId"].includes(key)) ||
      typeof input.resultId !== "string" || input.resultId.length > 150 ||
      !Object.hasOwn(CONDITIONS, input.condition) ||
      (input.neuronId != null && (typeof input.neuronId !== "string" || !/^\d{1,30}$/.test(input.neuronId))))
    throw fail("Choose a recording, condition and optional displayed neuron. Observer requests cannot contain actions.");
}

export function observerContext(recording, resultId, input) {
  validateObservationRequest(input);
  if (!recording || input.resultId !== resultId) throw fail("The recording changed. Reload it before asking the observer.", 409);
  const trial = recording.conditions.find((trial) => trial.key === input.condition);
  if (!trial) throw fail("Condition is unavailable");
  const neuron = input.neuronId == null ? null : recording.nodes.find((node) => node.id === input.neuronId);
  if (input.neuronId != null && !neuron) throw fail("Choose a neuron in the displayed recording");
  const intact = recording.conditions.find((trial) => trial.key === "sugar");
  const disconnected = recording.conditions.find((trial) => trial.key === "sugar_disconnected");
  return {
    scope: "Completed recorded trial; whole-trial counts, not the playback cursor or live organism state",
    control_authority: "none; read-only observer",
    recording_id: resultId, dataset: recording.dataset, source_commit: recording.source_commit,
    condition: input.condition, manipulation: CONDITIONS[input.condition],
    parameters: { configured_stimulation_hz: recording.rate_hz,
      effective_stimulation_hz: input.condition === "baseline" ? 0 : recording.rate_hz,
      duration_ms: recording.duration_ms, seed: recording.seed },
    full_model: { neurons: recording.neurons, directed_connections: recording.directed_connections },
    recorded_counts: { total_spikes: trial.total_spikes, input_spikes: trial.input_spikes,
      downstream_spikes: trial.downstream_spikes, active_neurons: trial.active_neurons },
    paired_comparison: { intact_downstream_spikes: intact.downstream_spikes,
      disconnected_downstream_spikes: disconnected.downstream_spikes },
    selected_neuron: neuron ? { flywire_id: neuron.id, role: neuron.input ? "sugar sensor" : "downstream",
      condition_spikes: neuron.counts[input.condition], intact_spikes: neuron.counts.sugar,
      disconnected_spikes: neuron.counts.sugar_disconnected } : null,
    checks: { ...recording.checks },
    unavailable_information: ["body", "energy", "hunger", "movement", "encounters", "subjective feelings"],
  };
}

export function observerRequest(context) {
  return {
    model: OBSERVER_MODEL, stream: false,
    messages: [
      { role: "system", content: "You are a read-only scientific narrator for a simplified fly neural simulation. Describe only the supplied recorded observations in two short sentences, maximum 65 words. Speak in third person. Distinguish input-sensor spikes from downstream spikes and the selected condition from the paired comparison. Preserve numbers and units if you use them. Do not infer hunger, feelings, consciousness, intelligence, eating or movement. No body is attached. You cannot stimulate neurons, change weights, run code or issue actions. Do not invent observations or present speculation as measured evidence. Return plain commentary, no headings or markup." },
      { role: "user", content: `Explain this recorded condition and its comparison in plain language:\n${JSON.stringify(context)}` },
    ],
    options: { num_predict: 120, num_ctx: 2048, temperature: 0.2, seed: 42 },
    keep_alive: "10m",
  };
}

/** Receives a snapshot reader, never the model service or any action methods. */
export class BrainObserverService {
  constructor(readRecording, fetcher = fetch, options = {}) {
    this.readRecording = readRecording;
    this.fetcher = fetcher;
    this.auditFile = options.auditFile;
    this.timeoutMs = options.timeoutMs ?? 90000;
    this.entries = [];
    this.busy = false;
    this.closed = false;
    this.probeAt = 0;
    this.available = false;
    this.auditError = null;
    this.ready = this.restoreLog();
  }
  async restoreLog() {
    if (!this.auditFile) return;
    let file;
    try {
      file = await open(this.auditFile, "r");
      const { size } = await file.stat(), length = Math.min(size, 512 * 1024);
      const buffer = Buffer.alloc(length);
      await file.read(buffer, 0, length, size - length);
      const lines = buffer.toString("utf8").split("\n");
      if (size > length) lines.shift();
      for (const line of lines.slice(-41)) {
        try { const entry = JSON.parse(line); if (entry.schema === "brain-observer-v1") this.entries.push(entry); }
        catch { /* Ignore a partial final log line after an interrupted write. */ }
      }
      this.entries = this.entries.slice(-40);
    } catch (error) { if (error.code !== "ENOENT") this.auditError = "Could not restore the observer log"; }
    finally { await file?.close(); }
  }
  async probe() {
    if (this.closed) return false;
    if (Date.now() - this.probeAt < 10000) return this.available;
    this.probeAt = Date.now();
    try {
      const response = await this.fetcher(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) });
      const data = await response.json();
      this.available = Boolean(response.ok && data.models?.some((model) => model.name === OBSERVER_MODEL));
    } catch { this.available = false; }
    return this.available;
  }
  async status() {
    await this.ready;
    return { model: OBSERVER_MODEL, available: await this.probe(), busy: this.busy,
      readOnly: true, auditError: this.auditError };
  }
  async log() {
    await this.ready;
    return { entries: structuredClone(this.entries).reverse(), auditError: this.auditError };
  }
  async observe(input) {
    validateObservationRequest(input);
    if (this.closed) throw fail("Observer is shutting down", 503);
    if (this.busy) throw fail("The observer is already generating commentary", 409);
    this.busy = true;
    const controller = new AbortController();
    this.controller = controller;
    const task = this.execute(input, controller).finally(() => {
      this.busy = false;
      this.controller = null;
    });
    this.completion = task;
    return task;
  }
  async execute(input, controller) {
    let entry;
    try {
      await this.ready;
      const { recording, resultId } = await this.readRecording();
      const context = observerContext(recording, resultId, input);
      const request = observerRequest(context);
      entry = { schema: "brain-observer-v1", id: randomUUID(), createdAt: new Date().toISOString(),
        status: "pending", resultId, condition: input.condition, neuronId: input.neuronId ?? null,
        model: OBSERVER_MODEL, promptVersion: 1, readOnly: true, context,
        contextHash: createHash("sha256").update(JSON.stringify(context)).digest("hex"),
        request, commentary: null, error: null };
      this.entries.push(entry); this.entries = this.entries.slice(-40);
      if (!await this.probe()) throw fail("Start Ollama with llama2-uncensored:latest installed to use the observer", 503);
      controller.signal.throwIfAborted();
      const response = await this.fetcher(`${OLLAMA}/api/chat`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(request), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs)]),
      });
      const data = await response.json();
      controller.signal.throwIfAborted();
      if (!response.ok) throw fail("The local model could not generate commentary", 502);
      const text = data.message?.content;
      if (typeof text !== "string" || !text.trim()) throw fail("The local model returned empty commentary", 502);
      entry.commentary = text.trim().slice(0, 3000);
      entry.status = "complete";
      entry.completedAt = new Date().toISOString();
      return structuredClone(entry);
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const message = cancelled ? "Observation cancelled" : error.name === "TimeoutError" ? "Local observer timed out" :
        error.status ? error.message : "Ollama is unavailable on localhost";
      if (entry) { entry.status = cancelled ? "cancelled" : "failed"; entry.error = message; }
      throw fail(message, cancelled ? 409 : error.status ?? 503);
    } finally {
      if (entry) {
        entry.completedAt ??= new Date().toISOString();
        if (this.auditFile) {
          try {
            await mkdir(dirname(this.auditFile), { recursive: true });
            await appendFile(this.auditFile, JSON.stringify(entry) + "\n");
            this.auditError = null;
          } catch { this.auditError = "Commentary is visible in memory, but the log could not be saved to disk"; }
        }
      }
    }
  }
  async cancel() {
    this.controller?.abort();
    await this.completion?.catch(() => {});
    return this.status();
  }
  async close() {
    this.closed = true;
    await this.cancel();
  }
}
