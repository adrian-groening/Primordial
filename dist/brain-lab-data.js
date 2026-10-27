export function validateRecording(data) {
  const live = data?.schema === "brain-live-v1";
  if (!data || (!live && data.schema !== "brain-lab-v1") || !Number.isFinite(data.duration_ms) || data.duration_ms <= 0 ||
      !Array.isArray(data.nodes) || data.nodes.length > 256 || !Array.isArray(data.edges) || data.edges.length > 600 ||
      !Array.isArray(data.conditions) || data.conditions.length !== (live ? 1 : 4)) throw new Error("Unsupported brain recording");
  if (live && (!Number.isSafeInteger(data.sequence) || data.sequence < 1 ||
      !Number.isFinite(data.start_ms) || data.start_ms < 0 || !Number.isFinite(data.end_ms) ||
      Math.abs(data.end_ms - data.start_ms - data.duration_ms) > .001 ||
      !/^[a-f0-9]{64}$/.test(data.state_before) || !/^[a-f0-9]{64}$/.test(data.state_after))) throw new Error("Invalid live window");
  const indices = new Set();
  for (const node of data.nodes) {
    if (!Number.isInteger(node.index) || indices.has(node.index) || typeof node.id !== "string" || !/^\d+$/.test(node.id) ||
        !Number.isInteger(node.layer) || node.layer < 0 || node.layer > 5) throw new Error("Invalid recorded neuron");
    indices.add(node.index);
  }
  for (const edge of data.edges) {
    if (!indices.has(edge.source) || !indices.has(edge.target) || !Number.isFinite(edge.weight)) throw new Error("Invalid circuit connection");
  }
  const expected = new Set(live ? ["sugar"] : ["baseline", "sugar", "sugar_disconnected", "sugar_repeat"]);
  for (const trial of data.conditions) {
    if (!expected.delete(trial.key) || !Array.isArray(trial.events) || trial.events.length > 100000 ||
        !Number.isInteger(trial.total_spikes) || trial.total_spikes < 0 ||
        !Number.isInteger(trial.downstream_spikes) || trial.downstream_spikes < 0 ||
        !Number.isInteger(trial.input_spikes) || trial.input_spikes < 0 ||
        trial.input_spikes + trial.downstream_spikes !== trial.total_spikes) throw new Error("Invalid trial counts");
    let prior = -1;
    for (const event of trial.events) {
      if (!Array.isArray(event) || event.length !== 2 || !Number.isFinite(event[0]) || event[0] < prior ||
          event[0] < 0 || event[0] >= data.duration_ms || !indices.has(event[1])) throw new Error("Invalid spike event");
      prior = event[0];
    }
    for (const node of data.nodes) {
      if (!Number.isInteger(node.counts?.[trial.key]) || node.counts[trial.key] < 0) throw new Error("Missing neuron spike count");
    }
  }
  if (expected.size) throw new Error("Missing comparison condition");
  return data;
}

export function upperBound(values, value) {
  let lo = 0, hi = values.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (values[mid] <= value) lo = mid + 1; else hi = mid; }
  return lo;
}

export function indexSpikeTimes(condition) {
  const result = new Map();
  for (const [time, index] of condition.events) {
    if (!result.has(index)) result.set(index, []);
    result.get(index).push(time);
  }
  return result;
}

export function recentSpike(times, time, windowMs = 8) {
  if (!times?.length) return 0;
  const index = upperBound(times, time) - 1;
  return index < 0 ? 0 : Math.max(0, 1 - (time - times[index]) / windowMs);
}

export function comparison(data) {
  const intact = data.conditions.find((c) => c.key === "sugar");
  const disconnected = data.conditions.find((c) => c.key === "sugar_disconnected");
  return { intact, disconnected,
    reduction: intact.downstream_spikes ? 1 - disconnected.downstream_spikes / intact.downstream_spikes : null };
}
