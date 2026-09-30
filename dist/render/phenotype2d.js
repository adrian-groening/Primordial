const clamp01 = (value) => Math.max(0, Math.min(1, value));

/** Visible features are driven by inherited model traits, not current energy or age. */
export function appearanceFor(organism) {
  const predator = organism.role === "predator";
  const pace = clamp01((organism.speed - (predator ? 30 : 18)) / (predator ? 35 : 30));
  const reach = clamp01((organism.sense - 60) / 140);
  const markings = clamp01(organism.pattern ?? 0.5);
  const colorName = predator
    ? organism.hue < 18 ? "Copper" : organism.hue < 33 ? "Orange" : "Gold"
    : organism.hue < 117 ? "Lime" : organism.hue < 143 ? "Green" : "Teal";
  return {
    hue: organism.hue,
    colorName,
    saturation: 56 + pace * 22,
    bodyLength: organism.size * (predator ? 1.7 : 1.45),
    bodyHalfWidth: organism.size * (1.05 - pace * 0.28),
    tailLength: 7 + pace * 13,
    feelerLength: 2 + reach * 6,
    markingCount: 1 + Math.floor(markings * 2.999),
    markingStrength: 0.45 + markings * 0.5,
  };
}
