import { Worker } from "node:worker_threads";
import { resolve } from "node:path";

export class SimulationService {
  constructor(dataDirectory = resolve(".simulation-data")) {
    this.dataDirectory = dataDirectory; this.pending = new Map(); this.nextId = 1;
    this.worker = null; this.failure = null; this.closing = false;
  }
  start() {
    if (this.worker) return;
    this.worker = new Worker(new URL("./simulation-worker.mjs", import.meta.url), {
      workerData: { dataDirectory: this.dataDirectory },
    });
    this.worker.unref();
    this.worker.on("message", (message) => {
      if (message.ready) return;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer); this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error)); else entry.resolve(message);
      if (!this.pending.size) this.worker.unref();
    });
    const fail = (error) => {
      this.failure = error;
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
      this.pending.clear();
      this.worker.unref();
    };
    this.worker.on("error", fail);
    this.worker.on("exit", (code) => {
      if (!this.closing) fail(new Error(`Simulation worker stopped (exit ${code}). Restart the local server.`));
    });
  }
  request(action, payload = {}) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closing && action !== "shutdown") return Promise.reject(new Error("Simulation service is stopping"));
    this.start();
    this.worker.ref();
    const id = this.nextId++;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        if (!this.pending.size) this.worker.unref();
        reject(new Error("Simulation request timed out; it may still finish in the engine"));
      }, 120000);
      timer.unref();
      this.pending.set(id, { resolve: resolveRequest, reject, timer });
      this.worker.postMessage({ id, action, payload });
    });
  }
  close() {
    if (this.closePromise) return this.closePromise;
    if (!this.worker) return Promise.resolve();
    this.closing = true;
    this.closePromise = (async () => {
      try { if (!this.failure) await this.request("shutdown"); }
      finally { await this.worker.terminate(); }
    })();
    return this.closePromise;
  }
}
