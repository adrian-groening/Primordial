import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { OBSERVER_MODEL } from "./brain-observer-service.mjs";
import { validateBrainSettings } from "./brain-lab-service.mjs";
import { BrainLiveService } from "./brain-live-service.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { BrainOrganisms } from "./brain-organisms.mjs";
import { BrainEmbodied } from "./brain-embodied.mjs";
import { BrainFoodRace } from "./brain-food-race.mjs";

const OLLAMA = "http://127.0.0.1:11434";
const ACTIVE = new Set(["thinking", "running", "stopping"]);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function validateControlSettings(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !["resultId", "target_spikes_per_second", "duration_ms", "seed", "rounds", "mode", "interval_ms", "game_seconds", "plan_seconds", "swap_sides"].includes(key)) ||
      (input.mode !== undefined && !["continuous", "paired", "duo", "physical", "race"].includes(input.mode)) ||
      (input.game_seconds !== undefined && (!Number.isInteger(input.game_seconds) || input.game_seconds < 10 || input.game_seconds > 180)) ||
      (input.plan_seconds !== undefined && (!Number.isFinite(input.plan_seconds) || input.plan_seconds < .5 || input.plan_seconds > 5)) ||
      (input.swap_sides !== undefined && typeof input.swap_sides !== "boolean") ||
      (input.interval_ms !== undefined && (!Number.isInteger(input.interval_ms) || input.interval_ms < 2000 || input.interval_ms > 30000)) ||
      typeof input.resultId !== "string" || !input.resultId || input.resultId.length > 150 ||
      !Number.isInteger(input.target_spikes_per_second) || input.target_spikes_per_second < 0 || input.target_spikes_per_second > 100000 ||
      !Number.isInteger(input.rounds) || input.rounds < 1 || input.rounds > 5)
    throw fail("Choose a recording, target from 0–100000 downstream spikes/s, and 1–5 rounds");
  validateBrainSettings({ rate_hz: 25, duration_ms: input.duration_ms, seed: input.seed });
    return { ...input };
}
export function parseControlDecision(text) {
  let decision;
  try { decision = JSON.parse(text); } catch { throw fail("The LLM did not return a valid JSON decision; nothing was applied", 502); }
  if (!decision || typeof decision !== "object" || Array.isArray(decision) ||
      Object.keys(decision).length !== 2 || !Object.hasOwn(decision, "rate_hz") || !Object.hasOwn(decision, "rationale") ||
      !Number.isInteger(decision.rate_hz) || decision.rate_hz < 25 || decision.rate_hz > 250 ||
      typeof decision.rationale !== "string" || !decision.rationale.trim() || decision.rationale.length > 600)
    throw fail("The LLM proposed an unsupported decision; nothing was applied (allowed: 25–250 Hz and a short rationale)", 502);
  return { rate_hz: decision.rate_hz, rationale: decision.rationale.trim() };
}
export function measuredActivity(recording, resultId) {
  const intact = recording.conditions.find((trial) => trial.key === "sugar");
  const disconnected = recording.conditions.find((trial) => trial.key === "sugar_disconnected");
  if (!intact || (!disconnected && recording.schema !== "brain-live-v1") || !(recording.duration_ms > 0) || !Number.isSafeInteger(intact.downstream_spikes) || intact.downstream_spikes < 0)
    throw fail("Cannot measure the completed brain recording", 502);
  return { resultId, rate_hz: recording.rate_hz, duration_ms: recording.duration_ms, seed: recording.seed,
    downstream_spikes: intact.downstream_spikes,
    downstream_spikes_per_second: intact.downstream_spikes * 1000 / recording.duration_ms,
    input_spikes: intact.input_spikes, active_neurons: intact.active_neurons,
    disconnected_downstream_spikes: disconnected?.downstream_spikes ?? null,
    ...(recording.schema === "brain-live-v1" ? { start_ms: recording.start_ms, end_ms: recording.end_ms, sequence: recording.sequence } : {}),
    checks: { ...recording.checks } };
}
export function controlRequest(session, previous) {
  const error = previous.downstream_spikes_per_second - session.settings.target_spikes_per_second;
  const inBand = Math.abs(error) <= session.settings.target_spikes_per_second * .1;
  const context = {
    target_downstream_spikes_per_second: session.settings.target_spikes_per_second,
    latest_measurement: { rate_hz: previous.rate_hz,
      downstream_spikes_per_second: previous.downstream_spikes_per_second,
      duration_ms: previous.duration_ms, seed: previous.seed, resultId: previous.resultId },
    measured_activity_is: error > 0 ? "ABOVE target" : error < 0 ? "BELOW target" : "AT target",
    experimental_guidance: inBand ? "Keep this input rate; measured activity is within target tolerance." : error > 0 ? "Try a LOWER input rate to reduce activity." :
      error < 0 ? "Try a HIGHER input rate to increase activity." : "Keep this input rate.",
    allowed_input_rate_hz: { minimum: 25, maximum: 250 },
    next_trial_duration_ms: session.settings.duration_ms, fixed_seed: session.settings.seed,
    prior_rounds: session.steps.filter((step) => step.outcome).map((step) => ({ rate_hz: step.decision.rate_hz,
      downstream_spikes_per_second: step.outcome.downstream_spikes_per_second })),
    round: (session.decisionCount ?? session.steps.length) + 1,
    round_limit: session.settings.mode === "continuous" ? "until stopped; recent history is bounded" : session.settings.rounds,
    last_rejection: session.steps.at(-1)?.state === "rejected" ? "Previous reply was rejected. Use exactly rate_hz and rationale; do not return resultId or any other key." : null,
  };
  return { model: OBSERVER_MODEL, stream: false,
    format: session.settings.mode === "continuous" ? { type: "object", additionalProperties: false,
      properties: { rate_hz: { type: "integer", minimum: 25, maximum: 250 }, rationale: { type: "string", maxLength: 600 } },
      required: ["rate_hz", "rationale"] } : "json", keep_alive: "10m",
    messages: [{ role: "system", content: "Choose the next sensory input rate for a neural-model experiment. Read the exact target and latest measurement in the user message. Follow the experimental guidance; use prior rounds if available. Higher sensory input usually increases output but is not guaranteed. Return ONLY JSON with exactly two keys: rate_hz (integer 25–250) and rationale (one short sentence, at most 25 words, explaining the choice qualitatively). Do not invent measurements or targets. Do not put numbers in the rationale. No body or feelings exist in this experiment. Only rate_hz is applied. " + (session.settings.mode === "continuous" ? "The network runs continuously without resetting. Reaching the target means maintain it, not stop." : "Each experiment resets the neural state.") },
      { role: "user", content: JSON.stringify(context) }],
    options: { num_predict: 180, num_ctx: 4096, temperature: 0.2, seed: 42 } };
}

/** LLM chooses only a validated input rate; Brian2 produces all measured outcomes. */
export class BrainControlService {
  constructor(brain, fetcher = fetch, options = {}) {
    this.brain = brain; this.fetcher = fetcher;
    this.auditFile = options.auditFile;
    this.timeoutMs = options.timeoutMs ?? 90000;
    this.liveFactory = options.liveFactory ?? ((instanceId) => new BrainLiveService(brain, { ...options.live, instanceId }));
    this.wait = options.wait ?? delay;
    this.sessions = []; this.active = null; this.closed = false; this.auditError = null;
    this.ready = this.restore();
  }
  async restore() {
    if (!this.auditFile) return;
    try {
      const data = JSON.parse(await readFile(this.auditFile, "utf8"));
      if (data.schema !== "brain-control-v1" || !Array.isArray(data.sessions)) throw new Error("Invalid audit file");
      this.sessions = data.sessions.slice(0, 10);
      for (const session of this.sessions) if (ACTIVE.has(session.state)) {
        session.state = "interrupted"; session.reason = "Server stopped; control is never resumed automatically";
        session.completedAt = new Date().toISOString();
        const step = session.steps?.at(-1);
        if (step && step.state !== "complete") step.state = "interrupted";
      }
    } catch (error) { if (error.code !== "ENOENT") this.auditError = "Could not restore the controller log"; }
  }
  async save() {
    if (!this.auditFile) return;
    const snapshot = JSON.stringify({ schema: "brain-control-v1", sessions: this.sessions });
    this.saving = (this.saving ?? Promise.resolve()).then(async () => {
      try {
        await mkdir(dirname(this.auditFile), { recursive: true });
        await writeFile(this.auditFile + ".tmp", snapshot);
        await rename(this.auditFile + ".tmp", this.auditFile);
        this.auditError = null;
      } catch { this.auditError = "Control log is visible in memory but could not be saved to disk"; }
    });
    await this.saving;
  }
  async status() {
    await this.ready;
    return structuredClone({ model: this.embodied && this.sessions[0]?.settings.mode !== "race" ? null : OBSERVER_MODEL, active: Boolean(this.active), session: this.sessions[0] ?? null,
      sessions: this.sessions, auditError: this.auditError, organisms: this.embodied?.status() ?? this.duo?.status() ?? [],
      world: this.embodied?.world.snapshot() ?? this.sessions[0]?.world ?? null,
      live: this.live ? { progress: this.live.progress, latestId: this.live.latest?.resultId,
        samples: this.live.samples, active: Boolean(this.live.child) } : null });
  }
  async start(input) {
    const settings = validateControlSettings(input);
    await this.ready; await this.brain.ready;
    if (this.closed) throw fail("Controller is shutting down", 503);
    if (this.active) throw fail("LLM control is already running", 409);
    if (!this.brain.result || this.brain.resultId !== settings.resultId) throw fail("The recording changed. Reload before starting control.", 409);
    const session = { id: randomUUID(), createdAt: new Date().toISOString(), state: "thinking", settings,
      dataset: this.brain.result.dataset, source_commit: this.brain.result.source_commit,
      initial: measuredActivity(this.brain.result, this.brain.resultId), steps: [], reason: null, error: null };
    this.brain.acquireControl(session.id, ["physical", "race"].includes(settings.mode) ? "physical" : "llm");
    this.duo = null;
    this.embodied = null;
    if (settings.mode !== "continuous") this.live = null;
    this.active = session; this.sessions = [session, ...this.sessions].slice(0, 10);
    this.abort = new AbortController();
    // Return immediately; work and cancellation continue independently of the browser.
    this.completion = this.execute(session, this.abort).finally(() => {
      this.brain.releaseControl(session.id); this.active = null; this.abort = null;
    });
    return this.status();
  }
  async execute(session, controller) {
    if (session.settings.mode === "race") {
      this.embodied = new BrainFoodRace(session, { liveFactory: this.liveFactory, save: () => this.save(), measure: measuredActivity,
        fetcher: this.fetcher, timeoutMs: this.timeoutMs });
      this.live = this.embodied.agents[0].live;
      return this.embodied.run(controller);
    }
    if (session.settings.mode === "physical") {
      this.embodied = new BrainEmbodied(session, { liveFactory: this.liveFactory, save: () => this.save(), measure: measuredActivity });
      this.live = this.embodied.agents[0].live;
      return this.embodied.run(controller);
    }
    if (session.settings.mode === "duo") {
      this.duo = new BrainOrganisms(session, { liveFactory: this.liveFactory, fetcher: this.fetcher,
        wait: this.wait, timeoutMs: this.timeoutMs, save: () => this.save(), measure: measuredActivity,
        request: controlRequest, parseRate: parseControlDecision });
      this.live = this.duo.agents[0].live;
      return this.duo.run(controller);
    }
    if (session.settings.mode === "continuous") return this.executeContinuous(session, controller);
    try {
      let previous = session.initial;
      for (let round = 0; round < session.settings.rounds; round++) {
        controller.signal.throwIfAborted();
        session.state = "thinking";
        const request = controlRequest(session, previous);
        const step = { round: round + 1, createdAt: new Date().toISOString(), state: "thinking", request, rawReply: null,
          decision: null, appliedSettings: null, jobId: null, outcome: null };
        session.steps.push(step); await this.save();
        controller.signal.throwIfAborted();
        const response = await this.fetcher(`${OLLAMA}/api/chat`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(request), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs)]) });
        const data = await response.json();
        controller.signal.throwIfAborted();
        if (!response.ok) throw fail("Local LLM could not choose stimulation", 502);
        if (typeof data.message?.content !== "string" || data.message.content.length > 4000)
          throw fail("Local LLM returned an empty or oversized decision", 502);
        step.rawReply = data.message.content;
        step.decision = parseControlDecision(step.rawReply);
        step.appliedSettings = { rate_hz: step.decision.rate_hz, duration_ms: session.settings.duration_ms, seed: session.settings.seed };
        // Persist the exact decision before launching the real model.
        step.state = "validated"; await this.save(); controller.signal.throwIfAborted();
        const job = await this.brain.run(step.appliedSettings, session.id, controller.signal);
        step.jobId = job.jobId; step.state = "running"; session.state = "running"; await this.save();
        await this.brain.completion;
        controller.signal.throwIfAborted();
        if (this.brain.state !== "complete" || this.brain.resultId !== step.jobId)
          throw fail(this.brain.error ?? "The controlled brain experiment did not complete", 502);
        const outcome = measuredActivity(this.brain.result, this.brain.resultId);
        if (Object.entries(step.appliedSettings).some(([key, value]) => outcome[key] !== value))
          throw fail("Recorded settings did not match the LLM's applied settings", 502);
        step.outcome = outcome; step.state = "complete"; step.completedAt = new Date().toISOString();
        step.targetError = outcome.downstream_spikes_per_second - session.settings.target_spikes_per_second;
        previous = outcome;
        await this.save();
        const tolerance = session.settings.target_spikes_per_second * .1;
        if (Math.abs(step.targetError) <= tolerance) { session.reason = "Target reached within 10%"; break; }
      }
      session.state = "complete"; session.reason ??= "Round limit reached; target not reached";
    } catch (error) {
      session.state = controller.signal.aborted ? "cancelled" : "failed";
      session.error = controller.signal.aborted ? null : error.name === "TimeoutError" ? "Local LLM timed out" :
        error.status ? error.message : "Local model unavailable or experiment failed";
      session.reason = controller.signal.aborted ? "Stopped by user; completed recordings retained" : "Control stopped after an error";
      const step = session.steps.at(-1);
      if (step && step.state !== "complete") { step.state = session.state; step.error = session.error; }
    } finally {
      session.completedAt = new Date().toISOString(); await this.save();
    }
  }
  async cancel() {
    await this.ready;
    if (this.active) {
      const session = this.active, completion = this.completion;
      session.state = "stopping"; this.abort.abort();
      await this.embodied?.stop();
      await this.duo?.stop();
      await this.live?.stop();
      // Only the owned job can be stopped; a later manual experiment is never cancelled.
      if (this.brain.controlOwner === session.id) await this.brain.cancel(session.id);
      await completion;
    }
    return this.status();
  }
  async close() { this.closed = true; await this.cancel(); }

  getLive(id) {
    if (this.embodied) return this.embodied.getLive(id ?? "a");
    if (this.duo) return this.duo.getLive(id ?? "a");
    if (id != null) throw fail("Organism selection requires a two-organism session");
    return this.live;
  }
  async communication(input) {
    if (!this.active || !this.duo) throw fail("Start two organisms before changing their communication", 409);
    await this.duo.communication(input);
    return this.status();
  }

  async executeContinuous(session, controller) {
    this.live = this.liveFactory(); session.decisionCount = 0;
    try {
      session.state = "running"; await this.save();
      await this.live.start({ duration_ms: session.settings.duration_ms, seed: session.settings.seed,
        rate_hz: session.initial.rate_hz }, session.id, controller.signal);
      while (true) {
        controller.signal.throwIfAborted();
        if (this.live.failure) throw new Error(this.live.failure);
        const started = Date.now();
        const previous = measuredActivity(this.live.latest.recording, this.live.latest.resultId);
        const request = controlRequest(session, previous);
        session.state = "thinking";
        const step = { round: ++session.decisionCount, createdAt: new Date().toISOString(), state: "thinking",
          request, rawReply: null, decision: null, appliedSettings: null, outcome: null, jobId: null };
        session.steps = [...session.steps, step].slice(-20); await this.save();
        try {
          const response = await this.fetcher(`${OLLAMA}/api/chat`, { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify(request), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs)]) });
          const data = await response.json(); controller.signal.throwIfAborted();
          if (!response.ok || typeof data.message?.content !== "string" || data.message.content.length > 4000)
            throw fail("Local LLM returned an unavailable or invalid decision", 502);
          step.rawReply = data.message.content; step.decision = parseControlDecision(step.rawReply);
          session.warning = null;
        } catch (error) {
          controller.signal.throwIfAborted();
          if (this.live.failure) throw new Error(this.live.failure);
          step.state = "rejected"; step.error = error.name === "TimeoutError" ? "LLM decision timed out" : error.message;
          step.completedAt = new Date().toISOString();
          session.warning = `${step.error}. Holding the last valid input and retrying; the brain keeps running.`;
          session.state = "running"; await this.save();
          await this.wait(session.settings.interval_ms ?? 5000, null, { signal: controller.signal });
          continue;
        }
        step.appliedSettings = { rate_hz: step.decision.rate_hz, duration_ms: session.settings.duration_ms, seed: session.settings.seed };
        step.state = "validated"; await this.save(); controller.signal.throwIfAborted();
        const decisionId = `${session.id}:${step.round}`;
        this.live.setRate(step.decision.rate_hz, decisionId);
        session.state = "running"; step.state = "running";
        const window = await this.live.waitForWindow((recording) => recording.decision_id === decisionId, controller.signal);
        step.outcome = measuredActivity(window.recording, window.resultId);
        if (step.outcome.rate_hz !== step.decision.rate_hz) throw new Error("Live input did not match the decision");
        step.jobId = window.resultId; step.state = "complete"; step.completedAt = new Date().toISOString();
        step.targetError = step.outcome.downstream_spikes_per_second - session.settings.target_spikes_per_second;
        session.liveSummary = { ...step.outcome, network_builds: 1 };
        await this.save();
        await this.wait(Math.max(0, (session.settings.interval_ms ?? 5000) - (Date.now() - started)), null, { signal: controller.signal });
      }
    } catch (error) {
      session.state = controller.signal.aborted ? "cancelled" : "failed";
      session.warning = null;
      session.error = controller.signal.aborted ? null : error.name === "TimeoutError" ? "Local LLM timed out" : error.message;
      session.reason = controller.signal.aborted ? "Continuous control stopped; latest activity retained" : "Continuous control stopped after an error";
      const step = session.steps.at(-1);
      if (step && step.state !== "complete") { step.state = session.state; step.error = session.error; }
    } finally {
      await this.live.stop(); session.completedAt = new Date().toISOString(); await this.save();
    }
  }
}
