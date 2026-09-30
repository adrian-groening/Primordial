import { validateNeuralConfig, validateMutation } from "./sim/config.js";
// Small inherited feed-forward controllers. No external ML service or training runtime.
export const INPUTS = [
  "Food ahead",
  "Food lateral",
  "Food detected",
  "Energy",
  "Wall ahead",
  "Wall lateral",
  "Oscillator",
];
export const OUTPUTS = ["Turn", "Throttle"];
export function architecture(config) {
  validateNeuralConfig(config);
  return [
    INPUTS.length,
    ...Array(config.depth).fill(config.width),
    OUTPUTS.length,
  ];
}
export function parameterCount(config) {
  const sizes = architecture(config);
  return (
    config.count *
    sizes.slice(1).reduce((sum, n, i) => sum + n * (sizes[i] + 1), 0)
  );
}
export function createBrains(config, random, parent, mutation = 0) {
  const sizes = architecture(config);
  validateMutation(mutation);
  if (typeof random !== "function")
    throw new TypeError("random must be a function");
  if (parent !== undefined && parent !== null) {
    if (!Array.isArray(parent) || parent.length !== config.count)
      throw new RangeError(
        "Parent network count must match offspring architecture",
      );
    for (const network of parent) {
      validateNetwork(network);
      if (
        network.length !== sizes.length - 1 ||
        network.some(
          (layer, i) =>
            layer.length !== sizes[i + 1] ||
            layer.some((weights) => weights.length !== sizes[i] + 1),
        )
      ) {
        throw new RangeError(
          "Parent network dimensions must match offspring architecture",
        );
      }
    }
  }
  return Array.from({ length: config.count }, (_, network) =>
    sizes.slice(1).map((n, layer) =>
      Array.from({ length: n }, (_, neuron) =>
        Array.from({ length: sizes[layer] + 1 }, (_, weight) => {
          if (parent) {
            const value = parent[network][layer][neuron][weight];
            return Math.max(
              -4,
              Math.min(
                4,
                value +
                  (random() < mutation / 100 ? (random() - 0.5) * 0.8 : 0),
              ),
            );
          }
          return (random() * 2 - 1) * Math.sqrt(2 / sizes[layer]);
        }),
      ),
    ),
  );
}
function validateInputs(inputs) {
  if (
    !Array.isArray(inputs) ||
    inputs.length !== INPUTS.length ||
    !Array.from(inputs).every(Number.isFinite)
  ) {
    throw new TypeError(`Expected ${INPUTS.length} finite sensor inputs`);
  }
}

export function validateNetwork(network) {
  if (!Array.isArray(network) || network.length < 1 || network.length > 4)
    throw new RangeError("Network must have 1–4 computational layers");
  let previousWidth = INPUTS.length;
  for (let i = 0; i < network.length; i++) {
    const layer = network[i];
    if (!Array.isArray(layer) || layer.length < 1 || layer.length > 12)
      throw new RangeError("Invalid network layer width");
    if (i === network.length - 1 && layer.length !== OUTPUTS.length)
      throw new RangeError("Network must have two outputs");
    for (const weights of layer) {
      if (
        !Array.isArray(weights) ||
        weights.length !== previousWidth + 1 ||
        !Array.from(weights).every(Number.isFinite)
      )
        throw new TypeError("Invalid network weights or bias dimensions");
    }
    previousWidth = layer.length;
  }
}

export function evaluate(network, inputs) {
  validateInputs(inputs);
  validateNetwork(network);
  const activations = [inputs];
  for (const layer of network) {
    const previous = activations.at(-1);
    activations.push(
      layer.map((weights) =>
        Math.tanh(
          weights.at(-1) +
            previous.reduce((sum, a, i) => sum + a * weights[i], 0),
        ),
      ),
    );
  }
  return activations;
}
export function decide(brains, inputs) {
  validateInputs(inputs);
  if (!Array.isArray(brains) || brains.length > 4)
    throw new RangeError("Expected zero to four networks");
  const traces = Array.from(brains, (network) => evaluate(network, inputs));
  const output = [0, 0];
  for (const trace of traces)
    trace.at(-1).forEach((value, i) => (output[i] += value / traces.length));
  return { traces, output };
}
