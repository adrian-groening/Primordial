import { displacement } from "./spatial-grid.js";
import { segmentCircleHit } from "./obstacles2d.js";

/** Core body envelope matches the largest extent of each drawn body. */
export function bodyRadius(organism) {
  return organism.size * (organism.role === "predator" ? 1.7 : 1.45);
}

export function hasBodySpace(point, radius, organisms, obstacles, width, height, periodic, exceptId = null) {
  if (!periodic && (point.x - radius < 0 || point.y - radius < 0 ||
      point.x + radius > width || point.y + radius > height)) return false;
  for (const other of organisms) {
    if (other.dead || other.id === exceptId) continue;
    const d = displacement(point, other, width, height, periodic).squared;
    if (d < (radius + bodyRadius(other) + 0.01) ** 2) return false;
  }
  for (const obstacle of obstacles) {
    const d = displacement(point, obstacle, width, height, periodic).squared;
    if (d < (radius + obstacle.radius + 0.01) ** 2) return false;
  }
  return true;
}

export function freeBirthPosition(parent, childRadius, organisms, obstacles, width, height, periodic) {
  const startRadius = bodyRadius(parent) + childRadius + 0.02;
  for (let i = 0; i < 384; i++) {
    const angle = parent.angle + i * 2.399963229728653;
    const distance = startRadius + Math.sqrt(i) * childRadius * 0.55;
    let x = parent.x + Math.cos(angle) * distance;
    let y = parent.y + Math.sin(angle) * distance;
    if (periodic) {
      x = ((x % width) + width) % width;
      y = ((y % height) + height) % height;
    }
    const point = { x, y };
    if (hasBodySpace(point, childRadius, organisms, obstacles, width, height, periodic))
      return point;
  }
  return null;
}

/** Earliest swept body contact. Stable IDs, not storage order, break exact ties. */
export function firstBodyHit(start, end, mover, organisms, width, height, periodic) {
  const xs = periodic ? [-width, 0, width] : [0];
  const ys = periodic ? [-height, 0, height] : [0];
  let first = null, blockerId = Infinity;
  for (const other of organisms) {
    if (other.dead || other.id === mover.id) continue;
    for (const ox of xs) for (const oy of ys) {
      const hit = segmentCircleHit(start, end,
        { x: other.x + ox, y: other.y + oy, radius: bodyRadius(other) },
        bodyRadius(mover) + 0.01);
      if (hit !== null && (first === null || hit < first ||
          (hit === first && other.id < blockerId))) {
        first = hit;
        blockerId = other.id;
      }
    }
  }
  return first === null ? null : { fraction: first, blockerId };
}
