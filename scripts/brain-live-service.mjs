import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { validateRecording } from "../dist/brain-lab-data.js";

export class BrainLiveService extends EventEmitter {
  constructor(brain, options = {}) {
    super(); this.brain = brain;
    this.runner = options.runner ?? resolve(brain.root, "continuous_runner.py");
    this.timeoutMs = options.timeoutMs ?? 180000;
    this.instanceId = options.instanceId ?? null;
    if (this.instanceId && !/^[a-z]+$/.test(this.instanceId)) throw new Error("Invalid neural instance identity");
    this.latest = null; this.samples = []; this.progress = "Building persistent network";
    this.failure = null; this.child = null;
  }
  async start(settings, owner, signal) {
    await this.brain.ready;
    if (!await this.brain.available()) throw new Error("Local brain environment is unavailable");
    signal.throwIfAborted(); this.brain.assertOwner(owner);
    const runtimeId = `${owner}${this.instanceId ? `-${this.instanceId}` : ""}`;
    const output = resolve(this.brain.root, "results", `live-${runtimeId}`);
    const args = [this.runner, "--window-ms", String(settings.duration_ms), "--rate-hz", String(settings.rate_hz),
      "--seed", String(settings.seed), "--output", output];
    this.externalStep = settings.external_step === true;
    if (this.externalStep) args.push("--external-step");
    if (settings.engine) {
      if (!["numpy", "cython"].includes(settings.engine)) throw new Error("Unsupported neural engine");
      args.push("--engine", settings.engine);
    }
    const prefix = this.brain.launchPrefix;
    this.child = spawn(prefix[0] ?? this.brain.python, prefix.length ? [...prefix.slice(1), this.brain.python, ...args] : args,
      { cwd: this.brain.root, env: { ...process.env, PYTHONUNBUFFERED: "1", OMP_NUM_THREADS: "1" }, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "", stderr = "", stopped = false, watchdog;
    const heartbeat = () => { clearTimeout(watchdog); watchdog = setTimeout(() => {
      this.failure = "Persistent brain stopped producing activity"; this.stop();
    }, this.timeoutMs); watchdog.unref(); };
    this.resetWatchdog = heartbeat;
    heartbeat();
    this.child.stdin.on("error", () => {});
    this.child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > 8 * 1024 * 1024) { this.failure = "Live brain output exceeded its limit"; this.stop(); return; }
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const value = JSON.parse(line);
          if (value.type === "ready") { this.readyFlag = true; this.progress = "Network built · waiting for sensory input"; if(this.externalStep)clearTimeout(watchdog);else heartbeat(); this.emit("ready"); }
          if (value.type !== "window") continue;
          const recording = validateRecording(value.recording);
          if (recording.schema !== "brain-live-v1" || recording.network_builds !== 1 ||
            (this.latest && (recording.sequence !== this.latest.recording.sequence + 1 ||
              Math.abs(recording.start_ms - this.latest.recording.end_ms) > .001 ||
              recording.state_before !== this.latest.recording.state_after))) throw new Error("Live neural state continuity check failed");
          if (this.instanceId) recording.organism_id = this.instanceId;
          this.latest = { resultId: `live-${runtimeId}-${recording.sequence}`, recording };
          const trial = recording.conditions[0];
          this.samples.push({ sequence: recording.sequence, end_ms: recording.end_ms, rate_hz: recording.rate_hz,
            spikes_per_second: trial.downstream_spikes * 1000 / recording.duration_ms });
          this.samples = this.samples.slice(-120);
          this.progress = `Live · ${recording.end_ms.toFixed(0)} ms simulated · ${recording.rate_hz} Hz input`;
          if(this.externalStep)clearTimeout(watchdog);else heartbeat(); this.emit("window", this.latest);
        } catch (error) { this.failure = error.message; this.stop(); }
      }
    });
    this.child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    this.completion = new Promise((done) => {
      const finish = (error) => {
        if (stopped) return; stopped = true; clearTimeout(watchdog); clearTimeout(this.forceTimer);
        if (!this.stopping) this.failure ??= error ?? `Live brain exited. ${stderr}`;
        this.child = null; this.emit("ended"); done();
      };
      this.child.once("error", (error) => finish(error.message));
      this.child.once("close", () => finish());
    });
    return this.externalStep ? this.waitForReady(signal) : this.waitForWindow(() => true, signal);
  }
  waitForReady(signal) {
    signal.throwIfAborted();
    if (this.readyFlag) return Promise.resolve();
    if (this.failure || !this.child) return Promise.reject(new Error(this.failure ?? "Brain is stopped"));
    return new Promise((resolve, reject) => {
      const clean = () => { this.off("ready", ready); this.off("ended", ended); signal.removeEventListener("abort", aborted); };
      const ready = () => { clean(); resolve(); };
      const ended = () => { clean(); reject(new Error(this.failure ?? "Brain stopped before becoming ready")); };
      const aborted = () => { clean(); reject(signal.reason); };
      this.once("ready", ready); this.once("ended", ended); signal.addEventListener("abort", aborted, { once: true });
    });
  }
  waitForWindow(predicate, signal) {
    signal.throwIfAborted();
    if (this.failure) return Promise.reject(new Error(this.failure));
    if (this.latest && predicate(this.latest.recording)) return Promise.resolve(this.latest);
    if (!this.child) return Promise.reject(new Error("Live brain is stopped"));
    return new Promise((resolve, reject) => {
      const clean = () => { this.off("window", window); this.off("ended", ended); signal.removeEventListener("abort", aborted); };
      const window = (value) => { if (predicate(value.recording)) { clean(); resolve(value); } };
      const ended = () => { clean(); reject(new Error(this.failure ?? "Live brain stopped")); };
      const aborted = () => { clean(); reject(signal.reason); };
      this.on("window", window); this.once("ended", ended); signal.addEventListener("abort", aborted, { once: true });
    });
  }
  setRate(rate_hz, decision_id) {
    if (!Number.isInteger(rate_hz) || rate_hz < 25 || rate_hz > 250 || !this.child || this.failure)
      throw new Error("Cannot apply live stimulation");
    this.child.stdin.write(JSON.stringify({ rate_hz, decision_id }) + "\n");
  }
  stepSensory(rates, decision_id, signal) {
    signal.throwIfAborted();
    if (!this.externalStep || !this.child || this.failure || !rates ||
        Object.keys(rates).sort().join(",") !== "contact_hz,left_hz,right_hz" ||
        Object.values(rates).some((value) => !Number.isInteger(value) || value < 0 || value > 250))
      throw new Error("Invalid physical sensory command");
    const rate_hz = Math.round((rates.left_hz * 10 + rates.right_hz * 10 + rates.contact_hz) / 21);
    this.resetWatchdog();
    this.child.stdin.write(JSON.stringify({ rate_hz, sensory_rates: rates, decision_id }) + "\n");
    return this.waitForWindow((recording) => recording.decision_id === decision_id, signal);
  }
  async stop() {
    this.stopping = true;
    if (this.child) {
      this.child.kill("SIGTERM");
      if (!this.forceTimer) { this.forceTimer = setTimeout(() => this.child?.kill("SIGKILL"), 2000); this.forceTimer.unref(); }
    }
    await this.completion;
  }
}
