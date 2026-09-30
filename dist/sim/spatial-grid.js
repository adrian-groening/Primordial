/** Deterministic broad-phase lookup. Exact distances remain the caller's job. */
export class SpatialGrid {
  constructor(width, height, cellSize = 64, periodic = false) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.periodic = periodic;
    this.columns = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.cells = new Map();
  }

  key(x, y) {
    return y * this.columns + x;
  }

  insert(entity) {
    const x = Math.min(this.columns - 1, Math.floor(entity.x / this.cellSize));
    const y = Math.min(this.rows - 1, Math.floor(entity.y / this.cellSize));
    const key = this.key(x, y);
    if (!this.cells.has(key)) this.cells.set(key, []);
    this.cells.get(key).push(entity);
  }

  load(items) {
    this.cells.clear();
    for (const item of items) this.insert(item);
    return this;
  }

  query(x, y, radius) {
    const result = [];
    const seenCells = new Set();
    const xOffsets = this.periodic ? [-this.width, 0, this.width] : [0];
    const yOffsets = this.periodic ? [-this.height, 0, this.height] : [0];
    for (const ox of xOffsets) for (const oy of yOffsets) {
      const minX = Math.max(0, Math.floor((x + ox - radius) / this.cellSize));
      const maxX = Math.min(this.columns - 1, Math.floor((x + ox + radius) / this.cellSize));
      const minY = Math.max(0, Math.floor((y + oy - radius) / this.cellSize));
      const maxY = Math.min(this.rows - 1, Math.floor((y + oy + radius) / this.cellSize));
      for (let cy = minY; cy <= maxY; cy++) for (let cx = minX; cx <= maxX; cx++) {
        const key = this.key(cx, cy);
        if (!seenCells.has(key)) {
          seenCells.add(key);
          result.push(...(this.cells.get(key) ?? []));
        }
      }
    }
    return result;
  }
}

export function displacement(a, b, width, height, periodic = false) {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (periodic) {
    if (dx > width / 2) dx -= width;
    if (dx < -width / 2) dx += width;
    if (dy > height / 2) dy -= height;
    if (dy < -height / 2) dy += height;
  }
  return { dx, dy, squared: dx * dx + dy * dy };
}
