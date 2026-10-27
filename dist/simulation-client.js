/** The browser receives bounded observations; it never owns or steps a world. */
export class SimulationClient {
  constructor(fetcher = fetch) {
    this.fetcher = fetcher; this.queue = Promise.resolve(); this.snapshot = null;
    this.onSnapshot = () => {}; this.onError = () => {};
  }
  request(action, payload = {}) {
    const task = this.queue.then(async () => {
      const url = action === "snapshot"
        ? `/api/simulation?view=${payload.view === false ? 0 : 1}&selected=${payload.selectedId ?? ""}`
        : "/api/simulation";
      const fetcher = this.fetcher;
      const response = await fetcher(url, action === "snapshot" ? { cache: "no-store" } : {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, payload }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Local engine request failed");
      this.snapshot = data.snapshot; this.onSnapshot(data.snapshot); return data;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async poll(options) {
    try { await this.request("snapshot", options); }
    catch (error) { this.onError(error); }
  }
}
