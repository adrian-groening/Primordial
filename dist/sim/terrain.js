import { clamp } from "./sphere.js";
// Pure procedural terrain shared by the model and renderer: geometry is not a painted backdrop.
export function elevation(n) {
  const [x, y, z] = n;
  return clamp(
    0.48 +
      0.18 * Math.sin(x * 4 + z * 2) +
      0.17 * Math.sin(z * 5 - y * 3) +
      0.1 * Math.sin(y * 9 + x * 6) +
      0.055 * Math.sin(x * 19 + z * 13),
    0.03,
    0.97,
  );
}
export function habitat(n, environment) {
  const height = elevation(n),
    water = height < environment.seaLevel / 100,
    roughness = environment.ruggedness / 100;
  return {
    height,
    water,
    temperature:
      environment.temperature -
      Math.abs(n[1]) * 12 -
      Math.max(0, height - 0.65) * 12,
    cover: water
      ? 0
      : clamp(((0.76 - height) * 2 * environment.fertility) / 70, 0, 0.8),
    speed: water ? 0.4 : 1 - roughness * Math.max(0, height - 0.45) * 1.1,
  };
}
export function renderRadius(n, environment) {
  const height = elevation(n),
    sea = environment.seaLevel / 100;
  return 100 + Math.max(0, height - sea) * (3 + environment.ruggedness * 0.09);
}
