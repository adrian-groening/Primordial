// Preserve the pre-P00 public state shape even when implementation metadata changes.
export function legacyState(sim) {
  return Object.fromEntries(
    [
      "neural",
      "parameters",
      "seed",
      "brainSeed",
      "time",
      "nextId",
      "births",
      "organisms",
      "food",
      "renewal",
      "mutation",
      "history",
      "lastSample",
    ].map((key) => [key, sim[key]]),
  );
}
