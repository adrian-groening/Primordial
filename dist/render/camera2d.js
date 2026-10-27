/** Display-only camera. Coordinates are CSS pixels after device-pixel scaling. */
export class Camera2D {
  constructor() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }
  fit() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }
  transform(canvasWidth, canvasHeight, worldWidth, worldHeight) {
    const scale = Math.max(canvasWidth / worldWidth, canvasHeight / worldHeight) * this.zoom;
    const x = (canvasWidth - worldWidth * scale) / 2 + this.panX;
    const y = (canvasHeight - worldHeight * scale) / 2 + this.panY;
    return {
      scale,
      x: Math.max(canvasWidth - worldWidth * scale, Math.min(0, x)),
      y: Math.max(canvasHeight - worldHeight * scale, Math.min(0, y)),
    };
  }
  screenToWorld(x, y, canvasWidth, canvasHeight, worldWidth, worldHeight) {
    const t = this.transform(canvasWidth, canvasHeight, worldWidth, worldHeight);
    return { x: (x - t.x) / t.scale, y: (y - t.y) / t.scale };
  }
  zoomAt(factor, x, y, canvasWidth, canvasHeight, worldWidth, worldHeight) {
    const before = this.screenToWorld(x, y, canvasWidth, canvasHeight, worldWidth, worldHeight);
    this.zoom = Math.max(1, Math.min(this.maxZoom(worldWidth, worldHeight), this.zoom * factor));
    const after = this.transform(canvasWidth, canvasHeight, worldWidth, worldHeight);
    this.panX += x - (after.x + before.x * after.scale);
    this.panY += y - (after.y + before.y * after.scale);
  }
  maxZoom(worldWidth, worldHeight) {
    return Math.max(8, Math.min(512, Math.max(worldWidth, worldHeight) / 500));
  }
  inspect(entity, canvasWidth, canvasHeight, worldWidth, worldHeight) {
    const base = Math.max(canvasWidth / worldWidth, canvasHeight / worldHeight);
    this.zoom = Math.max(1, Math.min(this.maxZoom(worldWidth, worldHeight),
      Math.min(canvasWidth, canvasHeight) / (1000 * base)));
    this.panX = this.panY = 0;
    this.follow(entity, canvasWidth, canvasHeight, worldWidth, worldHeight);
  }
  follow(entity, canvasWidth, canvasHeight, worldWidth, worldHeight) {
    const t = this.transform(canvasWidth, canvasHeight, worldWidth, worldHeight);
    this.panX += canvasWidth / 2 - (t.x + entity.x * t.scale);
    this.panY += canvasHeight / 2 - (t.y + entity.y * t.scale);
  }
}
