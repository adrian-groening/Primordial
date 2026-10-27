import { mkdir, readFile, writeFile, rename, readdir, stat, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const newRunId = () => `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
export class SimulationStorage {
  constructor(directory) { this.directory = directory; this.writes = Promise.resolve(); }
  async init() { await mkdir(this.directory, { recursive: true }); }
  async atomic(name, value) {
    const path = join(this.directory, name), temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value));
    await rename(temporary, path);
  }
  checkpoint(envelope, manual = false) {
    const write = this.writes.then(() => this.writeCheckpoint(envelope, manual));
    this.writes = write.catch(() => {});
    return write;
  }
  async writeCheckpoint(envelope, manual = false) {
    await this.init();
    const name = `checkpoint-${newRunId()}.json`;
    if (manual) await this.atomic(name, envelope);
    await this.atomic("latest.json", envelope);
    return { name: manual ? name : "latest.json", tick: envelope.state.tick };
  }
  async read(name = "latest.json") {
    if (name !== "latest.json" && !/^checkpoint-[\w-]+\.json$/.test(name))
      throw new RangeError("Invalid checkpoint name");
    return JSON.parse(await readFile(join(this.directory, name), "utf8"));
  }
  async list() {
    await this.init();
    const names = (await readdir(this.directory))
      .filter((name) => name === "latest.json" || /^checkpoint-[\w-]+\.json$/.test(name));
    const rows = await Promise.all(names.map(async (name) => {
      const info = await stat(join(this.directory, name));
      return { name, bytes: info.size, savedAt: info.mtime.toISOString() };
    }));
    return rows.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  async record(runId, row) {
    await appendFile(join(this.directory, `metrics-${runId}.ndjson`), JSON.stringify(row) + "\n");
  }
  async recordPaths(runId, row) {
    await appendFile(join(this.directory, `paths-${runId}.ndjson`), JSON.stringify(row) + "\n");
  }
}
