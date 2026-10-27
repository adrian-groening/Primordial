import { INPUTS as SENSES } from "./predator-neural.js";
import { validateNeuralConfig, validateMutation } from "./config.js";

export const DEFAULT_NEURAL = Object.freeze({ count: 1, depth: 2, width: 8 });
export const INPUTS = [...SENSES, "Memory 1", "Memory 2", "Memory 3", "Memory 4",
  "Recent reward", "Dash ready", "Shield strength", "Signal strength",
  "Remembered food ahead", "Remembered food lateral", "Memory freshness", "Signal ahead", "Signal lateral", "Concealment"];
export const OUTPUTS = ["Turn", "Throttle", "Attack", "Feed", "Reproduce",
  "Dash", "Shield", "Signal", "Rest", "Camouflage", "Write memory 1", "Write memory 2", "Write memory 3", "Write memory 4"];
export const OBSERVATION_VERSION = "evolving-observation-v1";
const clamp = (value, min = -4, max = 4) => Math.max(min, Math.min(max, value));
export function validateArchitecture(config) {
  const value = validateNeuralConfig(config);
  if (!value.count) throw new RangeError("Evolving runs require at least one neural network");
  return value;
}
export function architecture(config) {
  validateArchitecture(config);
  return [INPUTS.length, ...Array(config.depth).fill(config.width), OUTPUTS.length];
}
export function parameterCount(config) {
  const sizes = architecture(config);
  return config.count * sizes.slice(1).reduce((sum, width, i) => sum + width * (sizes[i] + 1), 0);
}
export function createBrains(config, random, parent = null, mutation = 0) {
  const sizes = architecture(config);
  validateMutation(mutation);
  if (parent && (parent.length !== config.count || parent.some((net) => net.length !== sizes.length - 1 ||
    net.some((layer, i) => layer.length !== sizes[i + 1] || layer.some((row) => row.length !== sizes[i] + 1 || !row.every(Number.isFinite))))))
    throw new RangeError("Incompatible evolving parent genome");
  return Array.from({ length: config.count }, (_, n) => sizes.slice(1).map((width, l) =>
    Array.from({ length: width }, (_, j) => Array.from({ length: sizes[l] + 1 }, (_, i) =>
      parent ? clamp(parent[n][l][j][i] + (random() < mutation / 100 ? (random() - 0.5) * 0.5 : 0))
        : (random() * 2 - 1) * Math.sqrt(1 / sizes[l])))));
}
export function reshapeBrains(brains, config, random) {
  const next = createBrains(config, random);
  for (let n = 0; n < Math.min(brains.length, next.length); n++) {
    const copy = (from, to, neutralExtra = false) => {
      if (!from || !to) return;
      for (let j = 0; j < Math.min(from.length, to.length); j++) {
        for (let i = 0; i < to[j].length - 1; i++)
          if (i < from[j].length - 1) to[j][i] = from[j][i];
          else if (neutralExtra) to[j][i] = 0;
        to[j][to[j].length - 1] = from[j].at(-1);
      }
    };
    const old = brains[n], current = next[n];
    for (let l = 0; l < Math.min(old.length - 1, current.length - 1); l++) copy(old[l], current[l], l === 0);
    copy(old.at(-1), current.at(-1));
  }
  return next;
}
export function decide(brains, inputs) {
  if (inputs.length !== INPUTS.length || !inputs.every(Number.isFinite)) throw new RangeError("Invalid evolving observation");
  const output = Array(OUTPUTS.length).fill(0);
  const traces = brains.map((net) => {
    const trace = [inputs];
    for (const layer of net) {
      const previous = trace.at(-1), activation = [];
      for (const row of layer) {
        let sum = row[row.length - 1];
        for (let i = 0; i < previous.length; i++) sum += row[i] * previous[i];
        activation.push(Math.tanh(sum));
      }
      trace.push(activation);
    }
    trace.at(-1).forEach((value, i) => output[i] += value / brains.length);
    return trace;
  });
  return { output, traces };
}

/** Full backpropagation through each policy network. Memory is a one-step input, not BPTT. */
export function updatePolicy(brains, traces, outputGradient, rate) {
  let change = 0;
  for (let n = 0; n < brains.length; n++) {
    const net = brains[n], trace = traces[n];
    let delta = trace.at(-1).map((activation, i) =>
      clamp(outputGradient[i], -2, 2) * (1 - activation * activation) / brains.length);
    for (let l = net.length - 1; l >= 0; l--) {
      const prior = trace[l], layer = net[l], priorDelta = Array(prior.length).fill(0);
      for (let j = 0; j < layer.length; j++) {
        const row = layer[j];
        for (let i = 0; i < prior.length; i++) priorDelta[i] += delta[j] * row[i];
        for (let i = 0; i <= prior.length; i++) {
          const step = clamp(rate * delta[j] * (i === prior.length ? 1 : prior[i]), -0.04, 0.04);
          const value = clamp(row[i] + step);
          change += Math.abs(value - row[i]); row[i] = value;
        }
      }
      delta = priorDelta.map((value, i) => value * (1 - prior[i] * prior[i]));
    }
  }
  return change;
}
export function teach(brains, inputs, targets, rate) {
  const decision = decide(brains, inputs);
  const error = targets.map((target, i) => target - decision.output[i]);
  const loss = error.reduce((sum, value) => sum + value * value, 0) / error.length;
  const change = updatePolicy(brains, decision.traces, error, rate);
  return { loss, change };
}
