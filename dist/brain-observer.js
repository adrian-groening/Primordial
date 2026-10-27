export const observationKey = (selection) => selection ?
  JSON.stringify([selection.resultId, selection.condition, selection.neuronId ?? null]) : null;

/** UI controller: captured recording identity prevents stale replies being relabelled. */
export class BrainObserverController {
  constructor(request, notify = () => {}) {
    this.request = request;
    this.notify = notify;
    this.selection = null;
    this.entries = [];
    this.available = false;
    this.remoteBusy = false;
    this.busy = false;
    this.enabled = false;
    this.error = null;
    this.auditError = null;
    this.attempted = new Set();
    this.checking = false;
  }
  get current() {
    const key = observationKey(this.selection);
    return this.entries.find((entry) => observationKey(entry) === key && entry.status === "complete") ?? null;
  }
  select(selection, automatic = false) {
    this.selection = selection ? { ...selection } : null;
    this.error = null;
    this.notify();
    if (automatic && this.enabled) this.explain(false);
  }
  enable(value) {
    this.enabled = Boolean(value);
    this.notify();
    if (this.enabled) this.explain(false);
  }
  async check() {
    if (this.checking) return;
    this.checking = true;
    try {
      const [status, log] = await Promise.all([this.request("observer/status"), this.request("observer/log")]);
      this.available = status.available;
      this.remoteBusy = status.busy;
      this.auditError = log.auditError ?? status.auditError;
      this.entries = log.entries;
    } catch (error) { this.available = false; this.error = error.message; }
    finally { this.checking = false; this.notify(); }
    if (this.enabled) this.explain(false);
  }
  async explain(force = true) {
    if (!this.selection || !this.available || this.busy || this.remoteBusy) return;
    const selection = { ...this.selection }, key = observationKey(selection);
    if (!force && (this.current || this.attempted.has(key))) return;
    this.attempted.add(key);
    if (this.attempted.size > 100) this.attempted.delete(this.attempted.values().next().value);
    this.busy = true;
    this.error = null;
    this.notify();
    try {
      const entry = await this.request("observer/observe", selection);
      this.entries = [entry, ...this.entries.filter((old) => old.id !== entry.id)].slice(0, 40);
    } catch (error) {
      if (observationKey(this.selection) === key) this.error = error.message;
    } finally {
      this.busy = false;
      await this.check();
    }
  }
  async cancel() {
    try { await this.request("observer/cancel", {}); }
    catch (error) { this.error = error.message; }
    await this.check();
  }
}
