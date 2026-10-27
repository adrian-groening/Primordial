/** Bounded real engine paths, independent of browser visibility and render snapshots. */
export class TrajectoryRecorder {
  constructor({ limit = 256, capacity = 30000 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1024 || !Number.isInteger(capacity) || capacity < 1 || capacity > 100000)
      throw new RangeError("Invalid trajectory recording budget");
    this.limit = limit; this.capacity = capacity; this.reset();
  }
  reset(world = null) {
    this.width = world?.width ?? 1000; this.height = world?.height ?? 2000;
    this.sequence = 0; this.epoch = (this.epoch ?? 0) + 1;
    this.ring = []; this.cursor = 0; this.previous = new Map(); this.lastTick = -1;
  }
  capture(world) {
    if (world.width !== this.width || world.height !== this.height) this.reset(world);
    if (world.tick % 6 || world.tick === this.lastTick) return;
    this.lastTick = world.tick;
    let tracked = world.organisms.filter((o) => this.previous.has(o.id));
    const available = world.organisms.filter((o) => !this.previous.has(o.id));
    const needed = Math.min(this.limit - tracked.length, available.length);
    for (let i = 0; i < needed; i++) tracked.push(available[Math.floor(i * available.length / needed)]);
    const next = new Map();
    for (const o of tracked) {
      const before = this.previous.get(o.id);
      if (before && (before.x !== o.x || before.y !== o.y)) {
        const seam = world.boundary === "periodic" &&
          (Math.abs(before.x - o.x) > world.width / 2 || Math.abs(before.y - o.y) > world.height / 2);
        if (!seam) {
          const segment = { seq: ++this.sequence, id: o.id, generation: o.generation,
            x1: before.x, y1: before.y, x2: o.x, y2: o.y, tick: world.tick,
            hue: o.hue, role: o.role, ability: o.abilities?.dashUntil >= world.tick ? "dash"
              : o.abilities?.shieldUntil >= world.tick ? "shield"
              : o.abilities?.concealUntil >= world.tick ? "camouflage" : "move" };
          if (this.ring.length < this.capacity) this.ring.push(segment);
          else { this.ring[this.cursor] = segment; this.cursor = (this.cursor + 1) % this.capacity; }
        }
      }
      next.set(o.id, { x: o.x, y: o.y });
    }
    this.previous = next;
  }
  segments() {
    return this.ring.length < this.capacity ? [...this.ring]
      : [...this.ring.slice(this.cursor), ...this.ring.slice(0, this.cursor)];
  }
  snapshot(runId, since = 0, streamId = null) {
    const id = `${runId}:${this.epoch}`;
    const reset = streamId !== id || since > this.sequence;
    const all = this.segments();
    return { streamId: id, width: this.width, height: this.height, sequence: this.sequence,
      firstSequence: all[0]?.seq ?? 0, capacity: this.capacity, totalRecorded: this.sequence,
      tracked: this.previous.size, limit: this.limit, reset,
      segments: reset ? all : all.filter((segment) => segment.seq > since) };
  }
  exportState() {
    return { limit: this.limit, capacity: this.capacity, width: this.width, height: this.height,
      sequence: this.sequence, epoch: this.epoch, lastTick: this.lastTick,
      segments: this.segments(), previous: [...this.previous] };
  }
  static restore(state) {
    if (!state || !Array.isArray(state.segments) || !Array.isArray(state.previous) ||
      !Number.isSafeInteger(state.sequence) || state.sequence < 0 || !Number.isSafeInteger(state.epoch) || state.epoch < 0 ||
      !Number.isFinite(state.width) || !Number.isFinite(state.height) || state.width < 250 || state.height < 250)
      throw new RangeError("Invalid trajectory checkpoint");
    const recorder = new TrajectoryRecorder({ limit: state.limit, capacity: state.capacity });
    Object.assign(recorder, { width: state.width, height: state.height, sequence: state.sequence,
      epoch: state.epoch + 1, lastTick: state.lastTick, ring: state.segments.slice(-state.capacity),
      previous: new Map(state.previous), cursor: 0 });
    return recorder;
  }
}
