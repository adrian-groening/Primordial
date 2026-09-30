/** First hit of a moving point against a circle, with optional body radius. */
export function segmentCircleHit(start, end, circle, bodyRadius = 0) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const fx = start.x - circle.x, fy = start.y - circle.y;
  const radius = circle.radius + bodyRadius;
  const a = dx * dx + dy * dy;
  if (fx * fx + fy * fy <= radius * radius)
    return fx * dx + fy * dy >= 0 ? null : 0;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

export function firstObstacleHit(start, end, obstacles, width, height, periodic, bodyRadius = 0) {
  let first = null;
  const xs = periodic ? [-width, 0, width] : [0];
  const ys = periodic ? [-height, 0, height] : [0];
  for (const obstacle of obstacles) for (const ox of xs) for (const oy of ys) {
    const t = segmentCircleHit(start, end,
      { x: obstacle.x + ox, y: obstacle.y + oy, radius: obstacle.radius }, bodyRadius);
    if (t !== null && (first === null || t < first)) first = t;
  }
  return first;
}
