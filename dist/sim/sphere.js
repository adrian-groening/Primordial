export const RADIUS = 900;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add = (a, b) => a.map((v, i) => v + b[i]);
export const scale = (a, s) => a.map((v) => v * s);
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a) => {
  const n = Math.hypot(...a);
  return n > 1e-12 ? scale(a, 1 / n) : [1, 0, 0];
};
export const tangent = (n, v) => norm(add(v, scale(n, -dot(n, v))));
export const basis = (n) => {
  const east = norm(cross(Math.abs(n[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0], n));
  return [east, cross(n, east)];
};
export const distance = (a, b) => Math.acos(clamp(dot(a, b), -1, 1)) * RADIUS;
export function walk(n, heading, length) {
  const a = length / RADIUS;
  return norm(add(scale(n, Math.cos(a)), scale(heading, Math.sin(a))));
}
export function randomPoint(random) {
  const y = random() * 2 - 1,
    a = random() * Math.PI * 2,
    r = Math.sqrt(1 - y * y);
  return [r * Math.cos(a), y, r * Math.sin(a)];
}
export function offset(n, angle, length) {
  const [e, north] = basis(n);
  return walk(
    n,
    add(scale(e, Math.cos(angle)), scale(north, Math.sin(angle))),
    length,
  );
}
