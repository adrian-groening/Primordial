import {
  RADIUS,
  dot,
  clamp,
  tangent,
  basis,
  offset,
  walk,
  distance,
} from "./sphere.js";
import { habitat } from "./terrain.js";
// Adult envelope includes the enlarged visible appendages. It stays fixed while juveniles grow.
export const bodyRadius = (o) =>
  ((0.7 + o.traits.size * 0.095) * 3 * RADIUS) / 100;
export const territoryRadius = (o) =>
  bodyRadius(o) * (1.5 + o.traits.territory * 3);
export function hasSpace(n, radius, organisms, except = null) {
  return organisms.every(
    (o) =>
      o.dead ||
      o.id === except ||
      dot(n, o.n) <= Math.cos((radius + bodyRadius(o) + 0.01) / RADIUS),
  );
}
export function freePosition(center, radius, organisms, environment, swim) {
  for (let i = 0; i < 768; i++) {
    const n =
      i === 0
        ? [...center]
        : offset(
            center,
            i * 2.399963229728653,
            radius * (2.2 + Math.sqrt(i) * 0.6),
          );
    if (swim < 0.65 && habitat(n, environment).water) continue;
    if (hasSpace(n, radius, organisms)) return n;
  }
  return null;
}
// Minimum great-circle distance over the entire proposed movement, not just its endpoint.
export function movementBlockers(o, candidate, organisms) {
  const arc = distance(o.n, candidate) / RADIUS;
  const direction = arc > 1e-10 ? tangent(o.n, candidate) : basis(o.n)[0];
  return organisms.filter((other) => {
    if (other.dead || other.id === o.id) return false;
    const along = clamp(
      Math.atan2(dot(other.n, direction), dot(other.n, o.n)),
      0,
      arc,
    );
    const closest = walk(o.n, direction, along * RADIUS);
    return (
      dot(closest, other.n) >
      Math.cos((bodyRadius(o) + bodyRadius(other) + 0.01) / RADIUS)
    );
  });
}
