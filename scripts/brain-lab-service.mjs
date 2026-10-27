import { spawn } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { cpus } from "node:os";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedKeys = ["duration_ms", "rate_hz", "seed"];
export function validateBrainSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !expectedKeys.includes(key)))
    throw new Error("Provide duration_ms, rate_hz and seed only");
  const { duration_ms, rate_hz, seed } = value;
  if (!Number.isInteger(duration_ms) || duration_ms < 100 || duration_ms > 1000)
    throw new Error("Duration must be an integer from 100 to 1000 ms");
  if (!Number.isInteger(rate_hz) || rate_hz < 25 || rate_hz > 250)
    throw new Error("Stimulation must be an integer from 25 to 250 Hz");
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error("Seed must be an integer from 0 to 4294967295");
  return { duration_ms, rate_hz, seed };
}

export class BrainLabService {
  constructor(options = {}) {
    this.root = options.brainRoot ?? resolve(workspace, "brain");
    this.python = options.python ?? resolve(this.root, ".venv/bin/python");
    // A Rosetta Node process otherwise launches universal Python as x86_64,
    // which cannot import this Apple-Silicon environment's ARM wheels.
    this.launchPrefix = options.launchPrefix ?? (process.platform === "darwin" &&
      /Apple/.test(cpus()[0]?.model ?? "") && !options.python ? ["/usr/bin/arch", "-arm64"] : []);
    this.runner = options.runner ?? resolve(this.root, "lab_runner.py");
    this.defaultResult = options.defaultResult ?? resolve(workspace, "dist/data/brain-lab-reference.json");
    this.referenceFiles = options.referenceFiles ?? ["model.py", "2023_03_23_completeness_630_final.csv", "2023_03_23_connectivity_630_final.parquet"];
    this.timeoutMs = options.timeoutMs ?? 180000;
    this.state = "idle";
    this.progress = "Ready for a local experiment";
    this.result = null;
    this.resultId = null;
    this.child = null;
    this.error = null;
    this.closed = false;
    this.ready = this.loadLatest();
  }
  async loadLatest() {
    const runs = await readdir(resolve(this.root, "results")).catch(() => []);
    const candidates = runs.filter((name) => /^lab-\d+-[a-f0-9-]+$/.test(name)).sort().reverse();
    for (const [id, path] of [...candidates.map((id) => [id, resolve(this.root, "results", id, "playback.json")]), ["reference-200ms", this.defaultResult]]) {
      try {
        const data = JSON.parse(await readFile(path, "utf8"));
        if (data.schema !== "brain-lab-v1" || !Array.isArray(data.conditions)) continue;
        this.result = data;
        this.resultId = id;
        break;
      } catch { /* Incomplete runs do not replace a completed recording. */ }
    }
  }
  async available() {
    try {
      await access(this.python, constants.X_OK);
      await access(this.runner);
      await Promise.all(this.referenceFiles.map((name) => access(resolve(this.root, "reference", name))));
      return true;
    } catch { return false; }
  }
  async status() {
    await this.ready;
    return { state: this.state, progress: this.progress, error: this.error,
      resultId: this.resultId, jobId: this.jobId ?? null, settings: this.settings ?? null,
      controlSessionId: this.controlOwner ?? null,
      available: !this.closed && await this.available() };
  }
  assertOwner(owner) {
    if (this.controlOwner && owner !== this.controlOwner)
      throw Object.assign(new Error(`${this.controlKind === "physical" ? "The physical world" : "LLM control"} owns this experiment. Stop the active session first.`), { status: 409 });
    if (owner && owner !== this.controlOwner)
      throw Object.assign(new Error("The control session no longer owns the brain"), { status: 409 });
  }
  acquireControl(owner, kind = "llm") {
    if (this.closed || this.child || this.controlOwner)
      throw Object.assign(new Error("The brain is busy; wait for the experiment or control session to finish"), { status: 409 });
    this.controlOwner = owner;
    this.controlKind = kind;
  }
  releaseControl(owner) { if (this.controlOwner === owner) this.controlOwner = null; }
  async run(input, owner = null, signal = null) {
    const settings = validateBrainSettings(input);
    await this.ready;
    signal?.throwIfAborted();
    this.assertOwner(owner);
    if (this.closed) throw Object.assign(new Error("Brain Lab is shutting down"), { status: 503 });
    if (this.child) throw Object.assign(new Error("An experiment is already running"), { status: 409 });
    if (!await this.available()) throw Object.assign(new Error("Local brain environment is missing. Follow brain/README.md to install it."), { status: 503 });
    // Recheck after asynchronous readiness checks; simultaneous requests cannot spawn two models.
    signal?.throwIfAborted();
    this.assertOwner(owner);
    if (this.child) throw Object.assign(new Error("An experiment is already running"), { status: 409 });
    if (this.closed) throw Object.assign(new Error("Brain Lab is shutting down"), { status: 503 });
    const id = `lab-${Date.now()}-${randomUUID()}`;
    const output = resolve(this.root, "results", id);
    this.jobId = id;
    this.settings = settings;
    this.state = "running";
    this.progress = "Building the reference network";
    this.error = null;
    const args = [this.runner, "--duration-ms", String(settings.duration_ms),
      "--rate-hz", String(settings.rate_hz), "--seed", String(settings.seed), "--output", output],
      command = this.launchPrefix[0] ?? this.python;
    const child = spawn(command, this.launchPrefix.length ? [...this.launchPrefix.slice(1), this.python, ...args] : args,
    { cwd: this.root, env: { ...process.env, PYTHONUNBUFFERED: "1", OMP_NUM_THREADS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    let tail = "", stderr = "", ended = false, cancelled = false, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; stop(); }, this.timeoutMs);
    timer.unref();
    let forceTimer;
    const stop = () => {
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
      forceTimer.unref();
    };
    this.cancelChild = () => { cancelled = true; stop(); };
    child.stdout.on("data", (chunk) => {
      tail = (tail + chunk.toString()).slice(-8192);
      const stages = [...tail.matchAll(/Running (baseline|sugar_disconnected|sugar_repeat|sugar):/g)];
      const stage = stages.at(-1)?.[1];
      if (stage) this.progress = ({ baseline: "1/4 · No stimulus", sugar: "2/4 · Intact circuit",
        sugar_disconnected: "3/4 · Disconnected inputs", sugar_repeat: "4/4 · Seeded repeat" })[stage];
      if (tail.includes("Exporting recorded activity")) this.progress = "Preparing spike playback";
    });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-4096); });
    this.completion = new Promise((done) => {
      const finish = async (code, error) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        clearTimeout(forceTimer);
        try {
          if (cancelled) {
            this.state = "cancelled";
            this.progress = "Experiment cancelled; previous recording retained";
          } else if (timedOut || error || code !== 0) {
            this.state = "failed";
            this.error = timedOut ? "Experiment exceeded the three-minute time limit" :
              error?.message ?? `Model exited with code ${code}. ${stderr.slice(-1000).trim()}`;
            this.progress = "Experiment failed; previous recording retained";
          } else {
            const data = JSON.parse(await readFile(resolve(output, "playback.json"), "utf8"));
            if (data.schema !== "brain-lab-v1" || !Array.isArray(data.conditions)) throw new Error("Invalid model recording");
            this.result = data;
            this.resultId = id;
            this.state = "complete";
            this.progress = "Experiment complete";
          }
        } catch (failure) {
          this.state = "failed";
          this.error = failure.message;
          this.progress = "Could not load the model recording";
        } finally {
          this.child = null;
          this.cancelChild = null;
          done();
        }
      };
      child.on("error", (error) => finish(null, error));
      child.on("close", (code) => finish(code));
    });
    return this.status();
  }
  async cancel(owner = null) {
    this.assertOwner(owner);
    this.cancelChild?.();
    if (this.completion) await this.completion;
    return this.status();
  }
  async close() {
    this.closed = true;
    await this.cancel(this.controlOwner);
  }
}
