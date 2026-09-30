export const MODEL_HZ = 30;
export const TICK_SECONDS = 1 / MODEL_HZ;

/** Playback time is UI state; only whole ticks enter the model. */
export class TickClock {
  constructor() {
    this.remainder = 0;
  }

  request(seconds, speed = 1) {
    if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(speed) || speed <= 0)
      throw new RangeError("Clock inputs must be finite and positive");
    this.remainder += seconds * speed * MODEL_HZ;
    const ticks = Math.floor(this.remainder + 1e-10);
    this.remainder = Math.max(0, this.remainder - ticks);
    return ticks;
  }
}
