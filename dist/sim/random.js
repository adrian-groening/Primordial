export const RNG_VERSION = "lcg32-v1";

export function drawUint32(state) {
  const next = (Math.imul(1664525, state) + 1013904223) >>> 0;
  return { state: next, value: next / 4294967296 };
}

export function drawStream(world, field) {
  const draw = drawUint32(world[field]);
  world[field] = draw.state;
  return draw.value;
}
