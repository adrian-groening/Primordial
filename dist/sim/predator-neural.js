import { validateNeuralConfig, validateMutation } from "./config.js";
export const INPUTS = [
  "Food ahead",
  "Food lateral",
  "Food detected",
  "Threat ahead",
  "Threat lateral",
  "Threat detected",
  "Energy",
  "Health",
  "Wall ahead",
  "Wall lateral",
  "Oscillator",
  "Gut fullness",
  "Stamina",
  "Attack ready",
  "Food radial velocity",
  "Threat radial velocity",
  "Maturity",
  "Previous turn",
  "Previous throttle",
  "Previous attack",
  "Food apparent size",
  "Threat apparent size",
  "Goal turn",
];
export const OUTPUTS = ["Turn", "Throttle", "Attack", "Feed", "Reproduce"];
export const OBSERVATION_VERSION = "predator-observation-v3";
export function architecture(config) {
  validateNeuralConfig(config);
  return [
    INPUTS.length,
    ...Array(config.depth).fill(config.width),
    OUTPUTS.length,
  ];
}
export function parameterCount(config) {
  const s = architecture(config);
  return config.count * s.slice(1).reduce((n, w, i) => n + w * (s[i] + 1), 0);
}
export function createBrains(config, random, parent, mutation) {
  const sizes = architecture(config);
  validateMutation(mutation);
  if (
    parent &&
    (parent.length !== config.count ||
      parent.some(
        (net) =>
          net.length !== sizes.length - 1 ||
          net.some(
            (layer, i) =>
              layer.length !== sizes[i + 1] ||
              layer.some(
                (row) =>
                  row.length !== sizes[i] + 1 || !row.every(Number.isFinite),
              ),
          ),
      ))
  )
    throw new Error("Incompatible predator-v1 parent brain");
  return Array.from({ length: config.count }, (_, b) =>
    sizes
      .slice(1)
      .map((n, l) =>
        Array.from({ length: n }, (_, j) =>
          Array.from({ length: sizes[l] + 1 }, (_, k) =>
            parent
              ? Math.max(
                  -4,
                  Math.min(
                    4,
                    parent[b][l][j][k] +
                      (random() < mutation / 100 ? (random() - 0.5) * 0.8 : 0),
                  ),
                )
              : (random() * 2 - 1) * Math.sqrt(2 / sizes[l]),
          ),
        ),
      ),
  );
}
export function decide(brains, inputs, withTrace = true) {
  if (inputs.length !== INPUTS.length || !inputs.every(Number.isFinite))
    throw new Error(`Expected ${INPUTS.length} finite ${OBSERVATION_VERSION} inputs`);
  const traces = brains.map((net) => {
    const trace = withTrace ? [inputs] : [];
    let prior = inputs;
    for (const layer of net) {
      prior = layer.map((row) =>
        Math.tanh(row.at(-1) + prior.reduce((n, a, i) => n + a * row[i], 0)),
      );
      if (withTrace) trace.push(prior);
    }
    return { trace, output: prior };
  });
  const output = Array(OUTPUTS.length).fill(0);
  for (const net of traces)
    net.output.forEach((v, i) => (output[i] += v / traces.length));
  return { traces: withTrace ? traces.map((net) => net.trace) : [], output };
}
