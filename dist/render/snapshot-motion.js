/** Display-only interpolation between received positions; never advances a world. */
export class SnapshotMotion {
  constructor({ delay = 120, adaptive = true } = {}) {
    this.delay = delay;
    this.adaptive = adaptive;
    this.interval = delay;
    this.samples = [];
  }
  push(snapshot, receivedAt) {
    const previous = this.samples.at(-1);
    const old = previous?.snapshot;
    const reset = !old || snapshot.runtime?.paused ||
      old.runtime?.paused || snapshot.runtime?.runId !== old.runtime?.runId ||
      snapshot.tick < old.tick || snapshot.width !== old.width || snapshot.height !== old.height ||
      snapshot.boundary !== old.boundary || !old.organisms.length || !snapshot.organisms.length ||
      receivedAt - previous.receivedAt > 1000;
    if (reset) this.samples = [];
    else if (this.adaptive) {
      this.interval = this.interval * 0.75 + (receivedAt - previous.receivedAt) * 0.25;
      this.delay = Math.max(80, Math.min(500, this.interval * 1.2));
    }
    this.samples.push({ snapshot, receivedAt });
    if (this.samples.length > 8) this.samples.shift();
  }
  frame(now) {
    if (!this.samples.length) return null;
    const target = now - this.delay;
    const first = this.samples[0], last = this.samples.at(-1);
    if (target <= first.receivedAt) return first.snapshot;
    if (target >= last.receivedAt) return last.snapshot;
    const index = this.samples.findIndex((sample) => sample.receivedAt >= target);
    const a = this.samples[index - 1], b = this.samples[index];
    const fraction = (target - a.receivedAt) / (b.receivedAt - a.receivedAt);
    const previous = new Map(a.snapshot.organisms.map((o) => [o.id, o]));
    const periodic = b.snapshot.boundary === "periodic";
    const coordinate = (start, end, length) => {
      let delta = end - start;
      if (periodic) {
        if (delta > length / 2) delta -= length;
        else if (delta < -length / 2) delta += length;
      }
      const value = start + delta * fraction;
      return periodic ? (value % length + length) % length : value;
    };
    return {
      ...b.snapshot,
      time: a.snapshot.time + (b.snapshot.time - a.snapshot.time) * fraction,
      tick: a.snapshot.tick + (b.snapshot.tick - a.snapshot.tick) * fraction,
      organisms: b.snapshot.organisms.map((o) => {
        const prior = previous.get(o.id);
        if (!prior) return o;
        const turn = Math.atan2(Math.sin(o.angle - prior.angle), Math.cos(o.angle - prior.angle));
        return { ...o,
          x: coordinate(prior.x, o.x, b.snapshot.width),
          y: coordinate(prior.y, o.y, b.snapshot.height),
          angle: prior.angle + turn * fraction,
        };
      }),
    };
  }
}
