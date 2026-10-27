import { add, scale, cross, dot, tangent, distance, clamp } from "./sphere.js";
import { territoryRadius } from "./space.js";

export function newMind() {
  return {
    intent: "exploring",
    commitmentUntil: 0,
    fear: 0,
    fatigue: 0,
    danger: null,
    dangerUntil: 0,
    lastEncounterId: null,
    signalAfter: 0,
    hostileTo: null,
    deviations: 0,
    reason: "Surveying habitat",
  };
}

export function rememberDanger(o, source, tick, intensity = 0.6) {
  o.mind.fear = Math.max(o.mind.fear, clamp(intensity, 0, 1));
  o.mind.danger = [...source.n];
  o.mind.dangerUntil = tick + 150;
  o.mind.lastEncounterId = source.id;
}

export function updateMind(o, dt, velocity) {
  o.mind.fear = Math.max(0, o.mind.fear - dt * 0.055);
  o.mind.fatigue = clamp(
    o.mind.fatigue + dt * (velocity > 2 ? 0.002 + velocity * 0.00028 : -0.055),
    0,
    1,
  );
}

const toward = (o, n) => tangent(o.n, n);
const away = (o, n) => scale(toward(o, n), -1);
function angleTo(o, direction) {
  return Math.atan2(
    dot(direction, cross(o.n, o.heading)),
    dot(direction, o.heading),
  );
}

// A compact, deterministic decision record. Future model-backed dialogue can read
// these observations and proposed intents without owning movement or safety rules.
export function chooseBehavior(o, perception, world, neuralOutput = null) {
  const { food, threat, neighbor } = perception;
  const m = o.mind;
  const energyFraction = o.energy / o.capacity;
  const injury = 1 - o.health / 100;
  const hazard = clamp(world.oxygenStress(o) / 15, 0, 1);
  const visibleRisk = threat
    ? clamp(1 - distance(o.n, threat.n) / Math.max(1, o.traits.sense), 0, 1)
    : 0;
  const rememberedRisk = m.dangerUntil > world.tick ? m.fear * 0.7 : 0;
  const risk = Math.max(visibleRisk, rememberedRisk);
  const urgentDanger =
    visibleRisk > 0.35 - o.traits.caution * 0.14 ||
    risk > 0.65 - o.traits.caution * 0.14;
  const hungry = energyFraction < 0.72;
  const exhausted = m.fatigue > 0.72;
  const needRecovery = o.health < 72 && energyFraction > 0.3;
  const kin =
    neighbor && neighbor.familyId === o.familyId && neighbor.role === o.role;
  const kinDistance = kin ? distance(o.n, neighbor.n) : Infinity;
  const rival =
    neighbor &&
    neighbor.familyId !== o.familyId &&
    distance(o.n, neighbor.n) < territoryRadius(o) + 55;
  const canBud =
    world.ready(o) && risk < 0.25 && m.fatigue < 0.7 && hazard < 0.55;
  let intent, reason, direction, throttle;
  if (urgentDanger) {
    intent = "escaping";
    reason = "Nearby danger or remembered injury";
    direction = away(o, threat?.n ?? m.danger ?? o.n);
    throttle = 1;
  } else if (
    rival &&
    (o.health < 50 || energyFraction < 0.28 || m.fear > 0.7)
  ) {
    intent = "retreating";
    reason = "A rival is near; survival takes priority over a fight";
    direction = away(o, neighbor.n);
    throttle = 0.8;
  } else if (
    rival &&
    o.traits.aggression > 0.25 &&
    o.health > 55 &&
    energyFraction > 0.42 &&
    m.fear < 0.6 &&
    world.random() < o.traits.aggression * 0.8
  ) {
    intent = "challenging";
    reason = "Defending a familiar feeding area from a rival";
    direction = toward(o, neighbor.n);
    throttle = 0.45;
  } else if ((exhausted || needRecovery) && energyFraction > 0.3) {
    intent = "resting";
    reason = exhausted
      ? "Fatigue exceeds safe activity level"
      : "Recovering from injury";
    direction = o.heading;
    throttle = 0;
  } else if (food && hungry) {
    intent = o.role === "predator" ? "hunting" : "foraging";
    reason = "Energy reserve is below comfort level";
    direction = toward(o, food.n);
    throttle = 0.75;
  } else if (risk > 0.2 && m.danger) {
    intent = "avoiding";
    reason = "Keeping distance from a recent threat";
    direction = away(o, m.danger);
    throttle = 0.65;
  } else if (food && energyFraction < 0.95) {
    intent = "foraging";
    reason = "Building reserve before reproduction";
    direction = toward(o, food.n);
    throttle = 0.55;
  } else if (
    energyFraction > 0.5 &&
    distance(o.n, o.territoryCenter) > territoryRadius(o) * 2.2
  ) {
    intent = "returning";
    reason = "Revisiting familiar territory";
    direction = toward(o, o.territoryCenter);
    throttle = 0.55;
  } else {
    intent = "exploring";
    reason = "No immediate survival need";
    const turn = (world.random() - 0.5) * (0.7 + o.traits.curiosity);
    direction = add(
      scale(o.heading, Math.cos(turn)),
      scale(cross(o.n, o.heading), Math.sin(turn)),
    );
    throttle = 0.45;
  }
  // Intent persists briefly, but an emergency always interrupts it.
  if (
    !urgentDanger &&
    m.commitmentUntil > world.tick &&
    m.intent === "resting" &&
    m.fatigue > 0.25 &&
    energyFraction > 0.3
  ) {
    intent = "resting";
    reason = "Finishing a recovery interval";
    direction = o.heading;
    throttle = 0;
  }
  // Individual exploration is a bounded deviation, never a forced suicidal move.
  const deviationChance = 0.015 + o.traits.curiosity * 0.045;
  if (
    !urgentDanger &&
    !["challenging", "retreating", "avoiding"].includes(intent) &&
    !needRecovery &&
    !exhausted &&
    energyFraction > 0.45 &&
    world.random() < deviationChance
  ) {
    const turn = (world.random() - 0.5) * 2.2;
    direction = add(
      scale(o.heading, Math.cos(turn)),
      scale(cross(o.n, o.heading), Math.sin(turn)),
    );
    intent =
      neighbor && world.random() < o.traits.sociability
        ? "approaching"
        : "investigating";
    if (intent === "approaching") direction = toward(o, neighbor.n);
    throttle = 0.4;
    reason = "Exploratory deviation from the current drive";
    m.deviations++;
  }
  if (intent !== m.intent) m.commitmentUntil = world.tick + 24;
  m.intent = intent;
  m.hostileTo = intent === "challenging" ? neighbor.id : null;
  m.reason = reason;
  const baseTurn = clamp(angleTo(o, direction) / 0.6, -1, 1);
  const brainTurn = neuralOutput?.[0] ?? 0;
  const brainThrottle = neuralOutput ? (neuralOutput[1] + 1) / 2 : throttle;
  const turn = urgentDanger
    ? baseTurn
    : clamp(baseTurn * 0.8 + brainTurn * 0.2, -1, 1);
  const actualThrottle = urgentDanger
    ? 1
    : intent === "resting"
      ? 0
      : clamp(throttle * 0.8 + brainThrottle * 0.2, 0, 1);
  const attack =
    o.role === "predator" &&
    intent === "hunting" &&
    energyFraction > 0.14 &&
    o.health > 25 &&
    (neuralOutput?.[2] ?? 1) > -0.25;
  const reproduce = canBud && (neuralOutput?.[3] ?? 1) > -0.25;
  o.action = intent;
  o.control = [
    turn,
    actualThrottle * 2 - 1,
    attack ? 1 : -1,
    reproduce ? 1 : -1,
  ];
  return {
    intent,
    reason,
    risk,
    energyFraction,
    fatigue: m.fatigue,
    fear: m.fear,
    hazard,
    canBud: reproduce,
    targetId: food?.id ?? null,
  };
}
