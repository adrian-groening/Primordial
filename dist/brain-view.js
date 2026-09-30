import { INPUTS, OUTPUTS } from "./neural.js";
export function drawBrain(canvas, organism, index) {
  const ctx = canvas.getContext("2d"),
    w = canvas.width,
    h = canvas.height,
    dpr = globalThis.devicePixelRatio || 1;
  ctx.clearRect(0, 0, w, h);
  const network = organism?.brains[index],
    trace = organism?.traces[index];
  if (!network) {
    ctx.fillStyle = "#858e9b";
    ctx.font = `${14 * dpr}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText("No neural controller selected", w / 2, h / 2);
    return;
  }
  const inputLabels = organism.inputLabels ?? INPUTS,
    outputLabels = organism.outputLabels ?? OUTPUTS;
  const layers = [inputLabels.length, ...network.map((layer) => layer.length)];
  const left = 100 * dpr,
    right = 75 * dpr,
    top = 30 * dpr,
    bottom = 20 * dpr;
  const point = (l, n) => [
    left + (l * (w - left - right)) / (layers.length - 1),
    top + ((n + 0.5) * (h - top - bottom)) / layers[l],
  ];
  network.forEach((layer, l) =>
    layer.forEach((weights, n) =>
      weights.slice(0, -1).forEach((weight, i) => {
        const a = point(l, i),
          b = point(l + 1, n);
        ctx.strokeStyle =
          weight >= 0
            ? `rgba(125,183,244,${Math.min(0.5, 0.05 + Math.abs(weight) * 0.22)})`
            : `rgba(238,161,110,${Math.min(0.5, 0.05 + Math.abs(weight) * 0.22)})`;
        ctx.lineWidth = dpr * 0.6;
        ctx.beginPath();
        ctx.moveTo(...a);
        ctx.lineTo(...b);
        ctx.stroke();
      }),
    ),
  );
  layers.forEach((count, l) => {
    ctx.fillStyle = "#929ba8";
    ctx.font = `${12 * dpr}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText(
      l === 0 ? "INPUT" : l === layers.length - 1 ? "OUTPUT" : `H${l}`,
      point(l, 0)[0],
      16 * dpr,
    );
    for (let n = 0; n < count; n++) {
      const [x, y] = point(l, n),
        a = trace?.[l]?.[n] ?? 0;
      ctx.beginPath();
      ctx.arc(x, y, 4 * dpr, 0, Math.PI * 2);
      ctx.fillStyle =
        a >= 0
          ? `rgba(125,183,244,${0.2 + 0.8 * Math.abs(a)})`
          : `rgba(238,161,110,${0.2 + 0.8 * Math.abs(a)})`;
      ctx.fill();
      ctx.strokeStyle = "#8392a3";
      ctx.stroke();
      if (l === 0 || l === layers.length - 1) {
        ctx.fillStyle = "#bac2cc";
        ctx.font = `${11 * dpr}px monospace`;
        ctx.textAlign = l === 0 ? "right" : "left";
        ctx.fillText(
          l === 0 ? inputLabels[n] : outputLabels[n],
          x + (l === 0 ? -10 : 10) * dpr,
          y + 4 * dpr,
        );
      }
    }
  });
}
