import { clamp } from "./sphere.js";
export const GENES = {
  territory: { label: "Territorial range", min: 0, max: 1, unit: "" },
  aggression: { label: "Defensive aggression", min: 0, max: 1, unit: "" },
  diet: { label: "Predatory specialization", min: 0, max: 1, unit: "" },
  hue: { label: "Pigment", min: 0, max: 359, unit: "°" },
  size: { label: "Body size", min: 4, max: 10, unit: "u" },
  speed: { label: "Cilia / movement", min: 24, max: 60, unit: "u/s" },
  armor: { label: "Armor plates", min: 0, max: 1, unit: "" },
  pattern: { label: "Dorsal markings", min: 0, max: 1, unit: "" },
  oxygen: { label: "Preferred oxygen", min: 10, max: 42, unit: "%" },
  tolerance: { label: "Oxygen tolerance", min: 4, max: 15, unit: "±%" },
  temperature: { label: "Preferred temperature", min: 4, max: 36, unit: "°C" },
  swim: { label: "Water adaptation", min: 0, max: 1, unit: "" },
  sense: { label: "Sensory range", min: 110, max: 270, unit: "u" },
};
// A single homozygous ancestor: no hidden starting genetic variation.
export function founderDNA() {
  const values = {
    territory: 0.35,
    aggression: 0.3,
    diet: 0.45,
    hue: 170,
    size: 5.8,
    speed: 35,
    armor: 0.2,
    pattern: 0.2,
    oxygen: 21,
    tolerance: 8,
    temperature: 24,
    swim: 0.35,
    sense: 190,
  };
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, [value, value]]),
  );
}
export function feedingRole(dna) {
  return (dna.diet[0] + dna.diet[1]) / 2 >= 0.6 ? "predator" : "prey";
}
export function budDNA(parent, random, mutation) {
  const dna = structuredClone(parent),
    mutations = [];
  for (const [key, g] of Object.entries(GENES)) {
    dna[key] = dna[key].map((value) => {
      if (random() >= mutation / 100) return value;
      mutations.push(key);
      return clamp(
        value + (random() - 0.5) * (g.max - g.min) * 0.28,
        g.min,
        g.max,
      );
    });
  }
  return { dna, mutations: [...new Set(mutations)] };
}
export function inheritDNA(a, b, random, mutation) {
  const dna = {},
    mutations = [];
  for (const [key, g] of Object.entries(GENES)) {
    dna[key] = [a, b].map((parent) => {
      let value = parent[key][random() < 0.5 ? 0 : 1];
      if (random() < mutation / 100) {
        value = clamp(
          value + (random() - 0.5) * (g.max - g.min) * 0.28,
          g.min,
          g.max,
        );
        mutations.push(key);
      }
      return value;
    });
  }
  return { dna, mutations: [...new Set(mutations)] };
}
export function express(dna) {
  return Object.fromEntries(
    Object.keys(GENES).map((key) => [key, (dna[key][0] + dna[key][1]) / 2]),
  );
}
export function variantKey(role, traits) {
  return `${role === "predator" ? "H" : "G"}-${Math.floor(traits.hue / 45)}${Math.floor(traits.oxygen / 5)}${Math.floor(traits.size / 2)}${Math.floor(traits.armor * 3)}`;
}
