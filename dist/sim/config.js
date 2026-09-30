/** Validation for the characterized legacy model; no ecological rules live here. */
export const MODEL_VERSION = "legacy-v1";
export const SCHEMA_VERSION = 1;
export const DEFAULT_NEURAL = Object.freeze({ count: 0, depth: 1, width: 6 });

export function numberInRange(value, name, min, max, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  if ((integer && !Number.isInteger(value)) || value < min || value > max) {
    throw new RangeError(
      `${name} must be ${integer ? "an integer " : ""}between ${min} and ${max}`,
    );
  }
  return value;
}

function objectWithKeys(value, name, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key))
      throw new TypeError(`Unknown ${name} field: ${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key))
      throw new TypeError(`Missing ${name} field: ${key}`);
  }
}

export function validateSeed(seed) {
  return numberInRange(seed, "seed", 0, 0xffffffff, true);
}

export function validateNeuralConfig(config) {
  objectWithKeys(config, "neural", ["count", "depth", "width"]);
  return {
    count: numberInRange(config.count, "neural.count", 0, 4, true),
    depth: numberInRange(config.depth, "neural.depth", 1, 3, true),
    width: numberInRange(config.width, "neural.width", 2, 12, true),
  };
}

export function validateMutation(value) {
  return numberInRange(value, "mutation", 0, 100);
}

/** Complete preset input. Unsupported world shapes/counts are rejected, not ignored. */
export function validateExperimentConfig(config) {
  objectWithKeys(config, "config", [
    "schemaVersion",
    "modelVersion",
    "seed",
    "mode",
    "world",
    "initial",
    "neural",
    "renewal",
    "mutation",
  ]);
  if (config.schemaVersion !== SCHEMA_VERSION)
    throw new RangeError("Unsupported schemaVersion");
  if (config.modelVersion !== MODEL_VERSION)
    throw new RangeError("Unsupported modelVersion");
  if (!["rule", "neural"].includes(config.mode))
    throw new RangeError("mode must be rule or neural");
  objectWithKeys(config.world, "world", ["width", "height"]);
  numberInRange(
    config.world.width,
    "world.width (fixed in legacy-v1)",
    1000,
    1000,
    true,
  );
  numberInRange(
    config.world.height,
    "world.height (fixed in legacy-v1)",
    700,
    700,
    true,
  );
  objectWithKeys(config.initial, "initial", ["organisms", "food"]);
  numberInRange(
    config.initial.organisms,
    "initial.organisms (fixed in legacy-v1)",
    64,
    64,
    true,
  );
  numberInRange(
    config.initial.food,
    "initial.food (fixed in legacy-v1)",
    230,
    230,
    true,
  );
  const neural = validateNeuralConfig(config.neural);
  if ((config.mode === "rule") !== (neural.count === 0))
    throw new RangeError("mode must agree with neural.count");
  return {
    schemaVersion: SCHEMA_VERSION,
    modelVersion: MODEL_VERSION,
    seed: validateSeed(config.seed),
    mode: config.mode,
    world: { ...config.world },
    initial: { ...config.initial },
    neural,
    renewal: numberInRange(config.renewal, "renewal", 0, 100),
    mutation: validateMutation(config.mutation),
  };
}
