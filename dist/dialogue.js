import { distance } from "./sim/sphere.js";

const safeText = (value, max = 240) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
const pairKey = (a, b) => [a.id, b.id].sort((x, y) => x - y).join(":");
export function conversationContext(world, speaker, listener, prior = "") {
  const family =
    world.families.get(speaker.familyId)?.name ?? "unknown lineage";
  const otherFamily =
    world.families.get(listener.familyId)?.name ?? "unknown lineage";
  const relationship =
    speaker.familyId === listener.familyId
      ? "same lineage"
      : "different lineages";
  const encounter = [...world.events]
    .reverse()
    .find(
      (e) =>
        [e.actorId, e.receiverId].includes(speaker.id) &&
        [e.actorId, e.receiverId].includes(listener.id),
    );
  const encounterText = encounter
    ? ` Their recent encounter was a ${encounter.type}.`
    : "";
  const situation = `At simulation time ${world.time.toFixed(1)} s, you are ${distance(speaker.n, listener.n).toFixed(0)} units apart (${relationship}).${encounterText} Your drive is ${safeText(speaker.mind.intent, 24)}: ${safeText(speaker.mind.reason, 75)}. Energy ${Math.round(speaker.energy)}/${speaker.capacity}, health ${Math.round(speaker.health)}/100, fear ${Math.round(speaker.mind.fear * 100)}%, fatigue ${Math.round(speaker.mind.fatigue * 100)}%. Atmosphere oxygen ${world.environment.oxygen}%.`;
  return {
    speaker: `${family} organism #${speaker.id}, generation ${speaker.generation}, ${speaker.role}`,
    listener: `${otherFamily} organism #${listener.id}, generation ${listener.generation}, ${listener.role}`,
    situation,
    prior: safeText(prior),
  };
}
export class DialogueManager {
  constructor(fetcher = fetch, onChange = () => {}) {
    this.fetcher = fetcher;
    this.onChange = onChange;
    this.available = false;
    this.enabled = true;
    this.busy = false;
    this.status = "Checking local Ollama…";
    this.model = "llama2-uncensored:latest";
    this.lines = [];
    this.world = null;
    this.version = 0;
    this.lastPair = new Map();
    this.seenSignals = new Set();
    this.lastScan = -30;
  }
  notify() {
    this.onChange(this);
  }
  attach(world) {
    this.world = world;
    this.version++;
    this.lines = [];
    this.busy = false;
    this.lastPair.clear();
    this.seenSignals.clear();
    this.lastScan = -30;
    this.status = this.available
      ? `Ready · ${this.model}`
      : "Local model unavailable";
    this.notify();
  }
  async check() {
    try {
      const response = await this.fetcher("/api/dialogue/status");
      const data = await response.json();
      this.available = Boolean(response.ok && data.available);
      this.model = safeText(data.model || this.model, 80);
      this.status = this.available
        ? `Ready · ${this.model}`
        : `Start Ollama with ${this.model}`;
    } catch {
      this.available = false;
      this.status = "Local dialogue bridge unavailable · run npm start";
    }
    this.notify();
    return this.available;
  }
  nearestPartner(world, actor) {
    if (!actor || actor.dead) return null;
    let best = null,
      bestDistance = Infinity;
    for (const candidate of world.organisms) {
      if (
        candidate.id === actor.id ||
        candidate.dead ||
        candidate.health < 25 ||
        candidate.energy < 8
      )
        continue;
      const d = distance(actor.n, candidate.n);
      if (
        d < Math.min(actor.traits.sense, candidate.traits.sense, 210) &&
        d < bestDistance
      ) {
        best = candidate;
        bestDistance = d;
      }
    }
    return best;
  }
  async converse(world, a, b, manual = false) {
    if (world !== this.world) this.attach(world);
    if (!this.available || this.busy || !a || !b || a.dead || b.dead)
      return false;
    const key = pairKey(a, b);
    if (!manual && world.tick - (this.lastPair.get(key) ?? -100000) < 600)
      return false;
    if (distance(a.n, b.n) > Math.min(a.traits.sense, b.traits.sense, 210))
      return false;
    this.busy = true;
    this.lastPair.set(key, world.tick);
    this.status = `Listening to #${a.id} and #${b.id}…`;
    this.notify();
    const version = this.version;
    let prior = "";
    try {
      for (const [speaker, listener] of [
        [a, b],
        [b, a],
      ]) {
        const response = await this.fetcher("/api/dialogue", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            conversationContext(world, speaker, listener, prior),
          ),
        });
        const result = await response.json();
        if (version !== this.version) return false;
        if (!response.ok)
          throw new Error(safeText(result.error || "Local model failed", 120));
        prior = safeText(result.line);
        if (!prior) throw new Error("Local model returned no dialogue");
        this.lines.push({
          speakerId: speaker.id,
          family: world.families.get(speaker.familyId)?.name ?? "Unknown",
          role: speaker.role,
          line: prior,
          time: world.time,
        });
        if (this.lines.length > 40)
          this.lines.splice(0, this.lines.length - 40);
        this.notify();
      }
      this.status = `Conversation complete · ${this.model}`;
      this.notify();
      return true;
    } catch (error) {
      if (version === this.version) {
        this.status = `Dialogue paused: ${safeText(error.message, 120)}`;
        this.notify();
      }
      return false;
    } finally {
      if (version === this.version) {
        this.busy = false;
        this.notify();
      }
    }
  }
  poll(world) {
    if (world !== this.world) this.attach(world);
    if (!this.available || !this.enabled || this.busy) return;
    for (const e of world.events) {
      if (e.type !== "signal") continue;
      const key = `${e.actorId}:${e.receiverId}:${e.until}`;
      if (this.seenSignals.has(key)) continue;
      this.seenSignals.add(key);
      if (this.seenSignals.size > 2000)
        this.seenSignals.delete(this.seenSignals.values().next().value);
      const a = world.organisms.find((o) => o.id === e.actorId),
        b = world.organisms.find((o) => o.id === e.receiverId);
      if (
        !a ||
        !b ||
        world.tick - (this.lastPair.get(pairKey(a, b)) ?? -100000) < 600
      )
        continue;
      this.converse(world, a, b);
      return;
    }
    if (world.tick < 120 || world.tick - this.lastScan < 30) return;
    this.lastScan = world.tick;
    const candidates = world.organisms.filter(
      (o) =>
        o.age >= 18 &&
        o.energy > 25 &&
        o.health > 35 &&
        !["escaping", "attacking", "hunting"].includes(o.mind.intent),
    );
    for (const a of candidates) {
      const b = this.nearestPartner(world, a);
      if (
        b &&
        b.age >= 18 &&
        !["escaping", "attacking", "hunting"].includes(b.mind.intent) &&
        world.tick - (this.lastPair.get(pairKey(a, b)) ?? -100000) >= 600
      ) {
        this.converse(world, a, b);
        return;
      }
    }
  }
}
