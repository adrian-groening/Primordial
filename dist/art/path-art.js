export const THEMES = ["aurora", "ember", "lineages"];
export function colorFor(segment, theme = "aurora") {
  const hue = theme === "lineages" ? (segment.id * 137.508) % 360
    : theme === "ember" ? segment.role === "predator" ? 18 : 35 + segment.generation * 8
      : segment.role === "predator" ? 320 + segment.generation * 7 : 165 + segment.generation * 14;
  return `hsl(${hue % 360},80%,${segment.ability === "dash" ? 78 : 64}%)`;
}
export function drawPathArt(canvas, art, theme = "aurora") {
  const ctx = canvas.getContext("2d"), w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#03070c"; ctx.fillRect(0, 0, w, h);
  if (!art) return;
  const padding = 20, scale = Math.min((w - padding * 2) / art.width, (h - padding * 2) / art.height);
  ctx.save();
  ctx.translate((w - art.width * scale) / 2, (h - art.height * scale) / 2);
  ctx.scale(scale, scale); ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const groups = new Map();
  for (const segment of art.segments) {
    const color = colorFor(segment, theme);
    if (!groups.has(color)) groups.set(color, []);
    groups.get(color).push(segment);
  }
  for (const glow of [true, false]) {
    ctx.globalAlpha = glow ? 0.08 : 0.4;
    ctx.lineWidth = (glow ? 4 : 1) / scale;
    for (const [color, segments] of groups) {
      ctx.strokeStyle = color; ctx.beginPath();
      for (const segment of segments) { ctx.moveTo(segment.x1, segment.y1); ctx.lineTo(segment.x2, segment.y2); }
      ctx.stroke();
    }
  }
  ctx.restore();
}
export function exportPathSVG(art, theme = "aurora") {
  if (!THEMES.includes(theme)) throw new RangeError("Unknown artwork palette");
  const scale = Math.min(1600 / art.width, 3200 / art.height);
  const width = Math.max(1, Math.round(art.width * scale)), height = Math.max(1, Math.round(art.height * scale));
  const groups = new Map();
  for (const segment of art.segments) {
    const color = colorFor(segment, theme);
    if (!groups.has(color)) groups.set(color, []);
    groups.get(color).push(`M${segment.x1.toFixed(2)},${segment.y1.toFixed(2)}L${segment.x2.toFixed(2)},${segment.y2.toFixed(2)}`);
  }
  const paths = [...groups].map(([color, commands]) => `<path stroke="${color}" d="${commands.join(" ")}"/>`).join("\n");
  const unit = art.width / width;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${art.width} ${art.height}">
<title>Primordial — paths of evolving organisms</title>
<desc>Actual recorded movement: ${art.segments.length} segments, palette ${theme}. No generated or interpolated paths.</desc>
<rect width="100%" height="100%" fill="#03070c"/>
<g fill="none" stroke-linecap="round" stroke-linejoin="round" style="mix-blend-mode:screen">
<g opacity="0.1" stroke-width="${4 * unit}">${paths}</g>
<g opacity="0.65" stroke-width="${unit}">${paths}</g>
</g></svg>`;
}
