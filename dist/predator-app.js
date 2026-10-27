import { architecture, parameterCount } from "./sim/evolving-neural.js";
import { drawBrain } from "./brain-view.js";
import { SimulationClient } from "./simulation-client.js";
import { Camera2D } from "./render/camera2d.js";
import { appearanceFor } from "./render/phenotype2d.js";
import { SnapshotMotion } from "./render/snapshot-motion.js";
import { drawPathArt } from "./art/path-art.js";
const $ = (id) => document.getElementById(id),
  canvas = $("world"), ctx = canvas.getContext("2d"), hc = $("history").getContext("2d");
const client = new SimulationClient();
let sim = { width: 1200, height: 800, neural: { count: 1, depth: 2, width: 8 },
  organisms: [], food: [], carcasses: [], obstacles: [], events: [], roleHistory: [],
  recentDeaths: [], deaths: {}, budgets: { organisms: 10000, food: 100000, carcasses: 20000 },
  initialPrey: 80, initialPredators: 8, initialFood: 230, fovDegrees: 360, boundary: "reflect",
  tick: 0, time: 0, births: 0, kills: 0, cannibalKills: 0,
  metrics: { population: 0, prey: 0, predators: 0, generation: 0, carcasses: 0 } };
let paused = true, speed = 1, selected = null, follow = false, achievedSpeed = 0;
let comparison = null, preview = !matchMedia("(prefers-reduced-motion: reduce)").matches;
let connected = false, pollTimer, lastDraw = 0;
let artTimer, art = null, artSequence = 0, artStream = null;
let viewInitialized = false;
const motion = new SnapshotMotion();
async function command(action, payload = {}, errorId = "engine-error") {
  try {
    $(errorId).textContent = "";
    return await client.request(action, payload);
  } catch (error) {
    $(errorId).textContent = error.message;
    return null;
  }
}
const camera = new Camera2D();
function setWorldAspect() {
  canvas.style.aspectRatio = `${sim.width} / ${sim.height}`;
}
function size() {
  for (const c of [canvas, $("history"), $("brain"), $("motion-art")]) {
    const r = c.getBoundingClientRect();
    c.width = Math.round(r.width * devicePixelRatio);
    c.height = Math.round(r.height * devicePixelRatio);
  }
  drawPathArt($("motion-art"), art, $("art-palette").value || "aurora");
}
new ResizeObserver(size).observe(canvas);
setWorldAspect();
size();
function draw() {
  if (!preview) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#969faa";
    ctx.font = `${16 * devicePixelRatio}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("Visualization off · local engine continues", canvas.width / 2, canvas.height / 2);
    ctx.textAlign = "left";
    return;
  }
  const w = canvas.width,
    h = canvas.height;
  const scene = motion.frame(performance.now()) ?? sim;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#05090b";
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  const target = follow && scene.organisms.find((o) => o.id === selected);
  if (target) camera.follow(target, w, h, sim.width, sim.height);
  const view = camera.transform(w, h, sim.width, sim.height);
  $("view-scale").textContent = `${camera.zoom.toFixed(1)}× zoom · ${Math.round(w / view.scale).toLocaleString()} LU across`;
  const bounds = { left: -view.x / view.scale, top: -view.y / view.scale,
    right: (w - view.x) / view.scale, bottom: (h - view.y) / view.scale };
  const visible = (item, radius = 25) => item.x + radius >= bounds.left && item.x - radius <= bounds.right &&
    item.y + radius >= bounds.top && item.y - radius <= bounds.bottom;
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);
  ctx.fillStyle = "#05090b";
  ctx.fillRect(0, 0, sim.width, sim.height);
  ctx.strokeStyle = "#ffffff08";
  ctx.lineWidth = 1 / view.scale;
  for (let x = 25 + Math.max(0, Math.ceil((bounds.left - 25) / 50)) * 50; x < Math.min(sim.width, bounds.right); x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, sim.height);
    ctx.stroke();
  }
  for (let y = 25 + Math.max(0, Math.ceil((bounds.top - 25) / 50)) * 50; y < Math.min(sim.height, bounds.bottom); y += 50) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(sim.width, y);
    ctx.stroke();
  }
  for (const obstacle of sim.obstacles) {
    if (!visible(obstacle, obstacle.radius)) continue;
    ctx.fillStyle = "#1b2328";
    ctx.strokeStyle = "#82909c";
    ctx.beginPath();
    ctx.arc(obstacle.x, obstacle.y, obstacle.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  for (const f of sim.food) {
    if (!visible(f, 2)) continue;
    ctx.fillStyle = "#a0a8b080";
    ctx.beginPath();
    ctx.arc(f.x, f.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const carcass of sim.carcasses) {
    if (!visible(carcass, 5)) continue;
    ctx.strokeStyle = "#ad8d7044";
    ctx.lineWidth = 1;
    const radius = Math.max(1, Math.min(5, Math.sqrt(carcass.energy) / 2));
    ctx.strokeRect(
      carcass.x - radius,
      carcass.y - radius,
      radius * 2,
      radius * 2,
    );
  }
  for (const event of scene.events) {
    if (event.kind === "impact") {
      const progress = Math.min(1, (scene.tick - event.tick) / 45);
      ctx.fillStyle = `rgba(240,154,100,${0.18 * (1 - progress)})`;
      ctx.strokeStyle = `rgba(255,206,156,${0.9 * (1 - progress)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(event.x, event.y, Math.max(8, event.radius * progress), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      continue;
    }
    ctx.strokeStyle = "#f19379aa";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(event.x1, event.y1);
    ctx.lineTo(event.x2, event.y2);
    ctx.stroke();
  }
  for (const o of scene.organisms) {
    if (!visible(o, o.id === selected ? o.sense : 40)) continue;
    ctx.save();
    if (o.activeAbilities?.camouflage) ctx.globalAlpha = 0.4;
    ctx.translate(o.x, o.y);
    const look = appearanceFor(o);
    if (o.activeAbilities?.shield) {
      ctx.strokeStyle = "#8dd9ff"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, o.size + 5, 0, Math.PI * 2); ctx.stroke();
    }
    if (o.activeAbilities?.signal) {
      ctx.strokeStyle = o.activeAbilities.signal > 0 ? "#b4d4ae88" : "#ff999988";
      ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, o.size + 10 + scene.tick % 30, 0, Math.PI * 2); ctx.stroke();
    }
    if (o.id === selected) {
      ctx.beginPath();
      ctx.arc(0, 0, o.sense, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff06";
      ctx.fill();
      ctx.strokeStyle = "#b9c8d940";
      ctx.setLineDash([3, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(0, 0, o.size + 10, 0, Math.PI * 2);
      ctx.strokeStyle = "#e4edf8";
      ctx.stroke();
    }
    ctx.rotate(o.angle);
    const col = `hsla(${look.hue},${look.saturation}%,72%,`;
    ctx.strokeStyle = col + ".48)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-o.size * 0.8, 0);
    ctx.quadraticCurveTo(
      -o.size - look.tailLength * 0.5,
      Math.sin(scene.time * 5 + o.id) * 3,
      -o.size - look.tailLength,
      0,
    );
    ctx.stroke();
    ctx.fillStyle = col + ".25)";
    ctx.strokeStyle = col + ".9)";
    ctx.beginPath();
    if (o.role === "predator") {
      ctx.moveTo(look.bodyLength, 0);
      ctx.lineTo(-o.size, look.bodyHalfWidth);
      ctx.lineTo(-o.size, -look.bodyHalfWidth);
      ctx.closePath();
    } else ctx.ellipse(0, 0, look.bodyLength, look.bodyHalfWidth, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = `hsla(${look.hue},85%,88%,${look.markingStrength})`;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 0.9;
    for (let mark = 0; mark < look.markingCount; mark++) {
      const x = (mark - (look.markingCount - 1) / 2) * o.size * 0.52;
      ctx.beginPath();
      if (o.role === "predator") {
        ctx.moveTo(x, -o.size * 0.25);
        ctx.lineTo(x, o.size * 0.25);
        ctx.stroke();
      } else {
        ctx.arc(x, 0, Math.max(0.8, o.size * 0.19), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = col + ".68)";
    ctx.lineWidth = 0.9;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(look.bodyLength * 0.7, side * o.size * 0.2);
      ctx.lineTo(look.bodyLength * 0.7 + look.feelerLength, side * o.size * 0.5);
      ctx.stroke();
    }
    ctx.restore();
    if (o.health < o.maxHealth) {
      ctx.fillStyle = "#3e2929";
      ctx.fillRect(o.x - 7, o.y - o.size - 6, 14, 2);
      ctx.fillStyle = "#dd9d8c";
      ctx.fillRect(o.x - 7, o.y - o.size - 6, (14 * o.health) / o.maxHealth, 2);
    }
  }
  ctx.restore();
}
function renderUI() {
  renderDecision();
  renderBrain();
  const mind = sim.metrics.intelligence;
  $("learning-updates").textContent = mind?.totalUpdates.toLocaleString() ?? "0";
  $("neural-autonomy").textContent = `${Math.round((mind?.meanAutonomy ?? 0.35) * 100)}%`;
  $("learning-reward").textContent = (mind?.meanReward ?? 0).toFixed(3);
  $("ability-variants").textContent = mind?.variants ?? 0;
  $("ability-status").textContent = mind ? `${mind.dashes} dashes · ${mind.shields} shields · ${mind.signals} signals · ${mind.rests} rests · ${mind.concealments} concealments` : "";
  $("time").textContent = Math.floor(sim.time) + " s";
  $("population").textContent = sim.metrics.population;
  const predators = sim.metrics.predators;
  $("predator-count").textContent = predators;
  $("prey-count").textContent = sim.metrics.prey;
  $("kill-count").textContent = sim.kills;
  $("predator-status").textContent =
    `Active: ${predators} predators. Changing the target updates this run.`;
  $("ecology-note").textContent = sim.limitReached
    ? `Technical ${sim.limitDiagnostic.store} limit (${sim.limitDiagnostic.budget}) at tick ${sim.limitDiagnostic.tick}; run paused and censored.`
    : `${sim.deaths.starvation} starvation deaths · ${sim.deaths.age} age deaths · ${sim.cannibalKills} cannibal kills · ${sim.metrics.carcasses} carcasses`;
  $("impact-status").textContent = sim.lastImpact
    ? `Skyfall at ${Math.floor(sim.lastImpact.tick / 30)} s · ${sim.lastImpact.casualties} organisms lost`
    : "A sudden impact can reshape the ecosystem.";
  $("skyfall").disabled = !!sim.limitDiagnostic;

  $("generation").textContent = sim.metrics.generation || "—";
  $("births").textContent = sim.births + " births";
  $("pause").textContent = paused ? "Play" : "Pause";
  $("status").textContent = !connected ? "Connecting to local engine…" : paused
    ? sim.limitReached ? "Technical limit — run paused" : "Local engine paused"
    : `Local engine running · ${speed === "max" ? "Maximum speed" : speed + "× selected"} · ${achievedSpeed.toFixed(1)}× actual`;
  $("engine-status").textContent = connected
    ? `${Math.round(sim.runtime.ticksPerSecond)} ticks/s · ${(sim.runtime.heapUsedBytes / 1048576).toFixed(0)} MB heap · tick ${sim.tick.toLocaleString()}`
    : "Local engine unavailable. Start it with npm start.";
  $("view-status").textContent = !preview ? "Visualization off. All organisms continue simulating."
    : sim.viewSampled ? `Showing ${sim.organisms.length.toLocaleString()} of ${sim.metrics.population.toLocaleString()} organisms. All organisms continue simulating.`
      : "Showing the live world. Closing this tab leaves the engine running.";
  $("engine-error").textContent = sim.runtime?.error ?? sim.runtime?.storageError ?? $("engine-error").textContent;
  const c = $("history"),
    w = c.width,
    h = c.height;
  hc.clearRect(0, 0, w, h);
  const dpr = devicePixelRatio,
    left = 30 * dpr,
    bottom = 16 * dpr;
  const max = Math.max(
    10,
    ...sim.roleHistory.map((r) => Math.max(r.prey, r.predators)),
  );
  hc.font = `${10 * dpr}px monospace`;
  hc.fillStyle = "#87919e";
  hc.textAlign = "left";
  hc.fillText(String(max), 0, 12 * dpr);
  hc.fillText("0", 0, h - bottom);
  const first = sim.roleHistory[0]?.time ?? 0,
    lastTime = sim.roleHistory.at(-1)?.time ?? 0;
  hc.fillText(`${first}s`, left, h - 2 * dpr);
  hc.textAlign = "right";
  hc.fillText(`${lastTime}s`, w, h - 2 * dpr);
  for (const [key, color] of [
    ["prey", "#a8cfa7"],
    ["predators", "#df9078"],
  ]) {
    hc.strokeStyle = color;
    hc.lineWidth = 1.5 * dpr;
    hc.beginPath();
    sim.roleHistory.forEach((row, i) => {
      const x =
          left + (i / Math.max(1, sim.roleHistory.length - 1)) * (w - left),
        y = h - bottom - (row[key] / max) * (h - bottom - 6 * dpr);
      i ? hc.lineTo(x, y) : hc.moveTo(x, y);
    });
    hc.stroke();
  }
  const o = sim.selected;
  if (o) {
    const look = appearanceFor(o);
    $("details").innerHTML =
      `<p style="color:hsl(${look.hue},${look.saturation}%,72%)">${o.role === "predator" ? "Predator" : "Prey"} #${o.id} <span style="float:right">Generation ${o.generation}</span></p><div class="energy"><div style="width:${(o.energy / o.capacity) * 100}%"></div></div><div class="trait">Reserve energy<b>${Math.round(o.energy)} / ${o.capacity} EU</b></div><div class="trait">Gut energy<b>${o.gutEnergy.toFixed(1)} / ${o.gutCapacity} EU</b></div><div class="trait">Health<b>${o.health.toFixed(1)} / ${o.maxHealth}</b></div><div class="trait">Stamina<b>${o.stamina.toFixed(1)} / ${o.maxStamina}</b></div><div class="trait">Behavior<b>${o.action}</b></div><div class="trait">Diet<b>${o.role === "predator" ? "Prey / carrion / survival cannibalism" : "Nutrients"}</b></div><div class="trait">Movement · tail length<b>${o.speed.toFixed(1)} LU/s</b></div><div class="trait">Sensing · feeler length<b>${Math.round(o.sense)} LU</b></div><div class="trait">Body size<b>${o.size.toFixed(1)} LU</b></div><div class="trait">Inherited color<b>${look.colorName}</b></div><div class="trait">Inherited markings<b>${look.markingCount}</b></div><div class="trait">Age<b>${Math.floor(o.age)} s</b></div>`;
    if (o.mind) $("details").innerHTML += `<div class="trait">Learning updates<b>${o.mind.updates}</b></div>
      <div class="trait">Weight adjustments<b>${o.mind.weightChange.toFixed(2)}</b></div>
      <div class="trait">Recent outcome<b>${o.mind.lastOutcome}</b></div>
      <div class="trait">Memory span<b>${(3 + o.genes.retention * 24).toFixed(1)} s</b></div>
      <div class="trait">Dash power<b>${Math.round(o.genes.dash * 100)}%</b></div>
      <div class="trait">Shield / camouflage<b>${Math.round(o.genes.shield * 100)}% / ${Math.round(o.genes.camouflage * 100)}%</b></div>
      <div class="trait">Energy assimilation<b>${Math.round(o.genes.metabolism * 100)}%</b></div>`;
  } else if (selected !== null) {
    const dead = sim.recentDeaths.find((o) => o.id === selected);
    $("details").textContent = dead
      ? `${dead.role} #${dead.id} died from ${dead.cause} at age ${dead.age.toFixed(1)} s.`
      : "This organism has died. Select another organism.";
  }
}
function renderDecision() {
  $("compare-food").disabled = !!comparison || !!sim.limitDiagnostic;
  $("apply-trial").hidden = true;
  $("keep-current").hidden = true;
  if (!comparison) {
    $("decision-progress").textContent = "";
    $("decision-result").innerHTML = "";
    return;
  }
  if (!comparison.done) {
    $("decision-progress").textContent = `Comparing futures… ${Math.floor(comparison.ticks / comparison.horizon * 100)}%`;
    return;
  }
  if (comparison.censored) {
    $("decision-progress").textContent = `Comparison stopped at a ${comparison.censored.store} technical limit. Increase the budget and compare again.`;
    $("keep-current").hidden = false;
    return;
  }
  const result = comparison.result;
  $("decision-progress").textContent = `Same start: ${comparison.start.prey} prey · ${comparison.start.predators} predators · 10-second comparison`;
  $("decision-result").innerHTML =
    `<p class="decision-result-line">Current food ${comparison.original}%: <b>${result.current.prey} prey</b> · ${result.current.predators} predators · ${result.current.food} food</p>` +
    `<p class="decision-result-line">Tested food ${comparison.proposed}%: <b>${result.trial.prey} prey</b> · ${result.trial.predators} predators · ${result.trial.food} food</p>` +
    `<p class="note">${result.message} This is one short simulated future, not a guaranteed outcome.</p>`;
  $("apply-trial").textContent = `Apply ${comparison.proposed}% food`;
  $("apply-trial").hidden = false;
  $("keep-current").hidden = false;
}
$("compare-food").onclick = () => command("compare");
$("apply-trial").onclick = () => command("applyComparison");
$("keep-current").onclick = () => command("discardComparison");
$("pause").onclick = () => command("playback", { paused: !paused });
$("skyfall").onclick = () => command("schedule", { type: "impact" });
document.querySelectorAll("[data-speed]").forEach((b) => {
  b.onclick = () => command("playback", { speed: b.dataset.speed === "max" ? "max" : Number(b.dataset.speed) });
});
for (const id of ["food", "mutation"]) $(id).oninput = () => {
  $(id + "-value").textContent = $(id).value + "%";
};
for (const id of ["food", "mutation"]) $(id).onchange = () =>
  command("schedule", { type: id === "food" ? "renewal" : "mutation", value: Number($(id).value) });
$("inspect").onclick = () => command("inspect", { previousId: selected });
$("reset").onclick = async () => {
  selected = null;
  await command("restart");
  camera.fit(); follow = false;
};
canvas.onclick = (e) => {
  if (canvas.wasDragged) { canvas.wasDragged = false; return; }
  const r = canvas.getBoundingClientRect(),
    point = camera.screenToWorld((e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height, canvas.width, canvas.height, sim.width, sim.height),
    { x, y } = point;
  let best = 24 ** 2;
  for (const o of sim.organisms) {
    const d = (x - o.x) ** 2 + (y - o.y) ** 2;
    if (d < best) {
      best = d;
      selected = o.id;
    }
  }
  client.poll({ selectedId: selected, view: preview });
};
canvas.onpointerdown = (e) => { canvas.dragStart = { x: e.clientX, y: e.clientY }; };
canvas.onpointermove = (e) => {
  if (!canvas.dragStart) return;
  const dx = e.clientX - canvas.dragStart.x, dy = e.clientY - canvas.dragStart.y;
  if (dx || dy) {
    camera.panX += dx * canvas.width / canvas.getBoundingClientRect().width;
    camera.panY += dy * canvas.height / canvas.getBoundingClientRect().height;
    canvas.wasDragged = true;
    follow = false;
  }
  canvas.dragStart = { x: e.clientX, y: e.clientY };
};
canvas.onpointerup = () => { canvas.dragStart = null; };
canvas.onwheel = (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  camera.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15,
    (e.clientX - r.left) * canvas.width / r.width,
    (e.clientY - r.top) * canvas.height / r.height,
    canvas.width, canvas.height, sim.width, sim.height);
};
$("fit-world").onclick = () => { follow = false; camera.fit(); };
function closeUp(track = false) {
  const target = sim.organisms.find((o) => o.id === selected) ?? sim.organisms.reduce((best, o) => {
    const distance = (item) => (item.x - sim.width / 2) ** 2 + (item.y - sim.height / 2) ** 2;
    return !best || distance(o) < distance(best) ? o : best;
  }, null);
  if (!target) return;
  selected = target.id;
  camera.inspect(target, canvas.width, canvas.height, sim.width, sim.height);
  follow = track;
  $("follow-selected").textContent = follow ? "Stop following" : "Follow selected";
}
$("close-up").onclick = () => {
  closeUp();
  return client.poll({ selectedId: selected, view: preview });
};
$("follow-selected").onclick = () => {
  if (follow) follow = false; else closeUp(true);
  $("follow-selected").textContent = follow ? "Stop following" : "Follow selected";
};
const settingNumber = (id, fallback) => $(id).value === "" ? fallback : Number($(id).value);
async function applyWorldSettings() {
  const settings = {
    width: settingNumber("world-width", sim.width), height: settingNumber("world-height", sim.height),
    boundary: $("boundary").value || sim.boundary, fovDegrees: settingNumber("fov", sim.fovDegrees),
    budgets: { organisms: settingNumber("organism-budget", sim.budgets.organisms),
      food: settingNumber("food-budget", sim.budgets.food), carcasses: settingNumber("carcass-budget", sim.budgets.carcasses) },
  };
  const prey = settingNumber("founder-prey", sim.initialPrey), food = settingNumber("founder-food", sim.initialFood);
  if (prey !== sim.initialPrey) settings.prey = prey;
  if (food !== sim.initialFood) settings.food = food;
  const response = await command("settings", settings, "world-error");
  if (response) $("world-error").textContent = `Applied at ${Math.floor(sim.time)} s · ${response.result.added} added · ${response.result.removed} removed`;
}
$("apply-world").onclick = applyWorldSettings;
for (const id of ["world-width", "world-height", "boundary", "fov", "founder-prey", "founder-food",
  "organism-budget", "food-budget", "carcass-budget"]) $(id).onchange = applyWorldSettings;
$("raise-budget").onclick = () => {
  if (!sim.limitDiagnostic) return;
  const store = sim.limitDiagnostic.store;
  const field = { organisms: "organism-budget", food: "food-budget", carcasses: "carcass-budget" }[store];
  return command("raiseBudget", { store, value: Number($(field).value) }, "world-error");
};
$("schedule-predators").onclick = async () => {
  const response = await command("schedule", { type: "introducePredators",
    value: Number($("introduction-count").value), tick: Number($("introduction-tick").value) }, "introduction-status");
  if (response) $("introduction-status").textContent = `${response.result.value} predators scheduled at tick ${response.result.tick}.`;
};
function frame(t) {
  if (!document.hidden && t - lastDraw >= (preview ? 0 : 250)) { draw(); lastDraw = t; }
  requestAnimationFrame(frame);
}
const pendingConfig = () => ({
  count: Number($("networks").value),
  depth: Number($("depth").value),
  width: Number($("width").value),
});
function updateArchitecture() {
  const c = pendingConfig();
  for (const id of ["networks", "depth", "width"])
    $(id + "-value").textContent = $(id).value;
  $("architecture").textContent = c.count
    ? `${c.count} × [${architecture(c).join(" → ")}] · ${parameterCount(c)} parameters / organism`
    : "Rule-based baseline · no neural parameters";
  $("depth").disabled = $("width").disabled = c.count === 0;
  const changed = JSON.stringify(c) !== JSON.stringify(sim.neural);
  $("apply-brain").textContent = changed
    ? "Apply to living organisms"
    : "Architecture active";
}
for (const id of ["networks", "depth", "width"])
  $(id).oninput = updateArchitecture;
async function applyBrainSettings() {
  const c = pendingConfig();
  const response = await command("settings", { neural: c }, "architecture");
  if (response) {
    $("network-view").replaceChildren(...Array.from({ length: Math.max(1, c.count) }, (_, i) => new Option(String(i + 1), String(i))));
    updateArchitecture();
  }
}
$("apply-brain").onclick = applyBrainSettings;
for (const id of ["networks", "depth", "width"]) $(id).onchange = applyBrainSettings;
function renderBrain() {
  const o = sim.selected;
  drawBrain($("brain"), o, Number($("network-view").value));
  $("brain-status").textContent = sim.neural.count
    ? `Active: ${sim.neural.count} network(s), ${sim.neural.depth} hidden layer(s), width ${sim.neural.width}.`
    : "Active: rule-based hunting / escape (0 networks).";
  $("brain-caption").textContent = o
    ? o.brains.length
      ? `${o.role === "predator" ? "Predator" : "Prey"} #${o.id} · generation ${o.generation} · ${o.parameterCount} plastic parameters · ${o.mind?.updates ?? 0} learning updates · decisions at 5 Hz`
      : `${o.role === "predator" ? "Predator" : "Prey"} #${o.id} uses rule-based hunting / escape. Set networks above zero and apply.`
    : "Select an organism to inspect its controller.";
  $("brain-readings").textContent = o?.brains.length
    ? `Turn: ${(o.control[0] * 3).toFixed(2)} rad/s · Throttle: ${Math.round(((o.control[1] + 1) / 2) * 100)}% · Attack: ${o.control[2] > 0 ? "requested" : "off"} · Feed: ${o.control[3] > 0 ? "requested" : "off"} · Reproduce: ${o.control[4] > 0 ? "requested" : "off"} · Controller energy cost: ${(o.parameterCount * 0.00015).toFixed(3)} EU/s`
    : "";
}
$("predators").oninput = () => {
  $("predators-value").textContent = $("predators").value;
  if (sim.intelligence) {
    $("learning-enabled").checked = sim.intelligence.enabled;
    $("bootstrap-enabled").checked = sim.intelligence.bootstrap;
    if (document.activeElement !== $("learning-rate")) $("learning-rate").value = String(sim.intelligence.rate);
    $("learning-rate-value").textContent = sim.intelligence.rate.toFixed(1) + "×";
  }
};
function applyPredatorSettings() {
  return command("settings", { predators: Number($("predators").value) }, "predator-status");
}
$("apply-predators").onclick = applyPredatorSettings;
$("predators").onchange = applyPredatorSettings;
$("inspect-predator").onclick = async () => {
  await command("inspect", { role: "predator", previousId: selected });
  if (!sim.metrics.predators) $("details").textContent = "No living predators. Raise the predator target to introduce them.";
};
$("network-view").onchange = renderBrain;
function syncFields() {
  const values = { "world-width": sim.width, "world-height": sim.height, boundary: sim.boundary,
    fov: sim.fovDegrees, "founder-prey": sim.initialPrey, "founder-food": sim.initialFood,
    "organism-budget": sim.budgets.organisms, "food-budget": sim.budgets.food, "carcass-budget": sim.budgets.carcasses,
    predators: sim.initialPredators, networks: sim.neural.count, depth: sim.neural.depth, width: sim.neural.width,
    food: sim.renewal, mutation: sim.mutation };
  for (const [id, value] of Object.entries(values)) if (document.activeElement !== $(id)) $(id).value = String(value);
  for (const id of ["food", "mutation"]) $(id + "-value").textContent = $(id).value + "%";
  $("predators-value").textContent = $("predators").value;
  updateArchitecture();
}
client.onSnapshot = (next) => {
  if (!connected) $("engine-error").textContent = "";
  const resized = sim.width !== next.width || sim.height !== next.height;
  sim = next; connected = true;
  motion.push(next, performance.now());
  paused = sim.runtime.paused; speed = sim.runtime.speed; achievedSpeed = sim.runtime.actualSpeed;
  comparison = sim.runtime.comparison;
  if (sim.selected) selected = sim.selected.id;
  else if (selected === null) $("details").innerHTML = "<p>No organism selected. Select one in the simulation to inspect its traits.</p>";
  document.querySelectorAll("[data-speed]").forEach((b) => b.classList.toggle("active", b.dataset.speed === String(speed)));
  if (resized) { setWorldAspect(); size(); camera.fit(); follow = false; }
  if (!viewInitialized && sim.organisms.length) {
    viewInitialized = true;
    if (Math.max(sim.width, sim.height) > 4000) closeUp();
  }
  syncFields(); renderUI();
};
client.onError = (error) => {
  connected = false; $("engine-error").textContent = error.message;
  $("engine-status").textContent = "Local engine unavailable. Start it with npm start.";
  $("status").textContent = "Disconnected · reconnecting…";
};
$("preview-toggle").onclick = () => {
  preview = !preview;
  $("preview-toggle").textContent = preview ? "Turn visualization off" : "Turn visualization on";
  return client.poll({ selectedId: selected, view: preview });
};
$("large-world").onclick = () => command("settings", { width: 12000, height: 12000,
  prey: 2000, predators: 100, food: 12000, neural: { count: 1, depth: 1, width: 6 },
  budgets: { organisms: 10000, food: 100000, carcasses: 20000 } });
for (const id of ["learning-enabled", "bootstrap-enabled", "learning-rate"]) $(id).onchange = () =>
  command("settings", { intelligence: { enabled: $("learning-enabled").checked,
    bootstrap: $("bootstrap-enabled").checked, rate: Number($("learning-rate").value) } });
$("learning-rate").oninput = () => { $("learning-rate-value").textContent = Number($("learning-rate").value).toFixed(1) + "×"; };
function download(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("art-palette").onchange = () => drawPathArt($("motion-art"), art, $("art-palette").value);
$("export-art-svg").onclick = async () => {
  const response = await command("artExport", { theme: $("art-palette").value || "aurora" });
  if (response) download(new Blob([response.result.svg], { type: "image/svg+xml" }), `primordial-paths-${response.result.tick}.svg`);
};
$("export-art-png").onclick = () => {
  if (!art) return;
  const output = document.createElement("canvas");
  output.width = 2400; output.height = Math.max(400, Math.min(3200, Math.round(2400 * art.height / art.width)));
  drawPathArt(output, art, $("art-palette").value || "aurora");
  output.toBlob((blob) => { if (blob) download(blob, `primordial-paths-${sim.tick}.png`); }, "image/png");
};
async function pollArt() {
  if (!document.hidden) {
    const response = await command("artSnapshot", { since: artSequence, streamId: artStream });
    if (response) {
      const next = response.result;
      const segments = next.reset ? next.segments : [...(art?.segments ?? []), ...next.segments].filter((row) => row.seq >= next.firstSequence);
      art = { ...next, segments: segments.slice(-next.capacity) };
      artSequence = next.sequence; artStream = next.streamId;
      if (next.reset || next.segments.length) drawPathArt($("motion-art"), art, $("art-palette").value || "aurora");
      $("art-status").textContent = `${art.segments.length.toLocaleString()} recorded path segments · up to ${next.limit} artists · ${Math.max(0, next.totalRecorded - art.segments.length).toLocaleString()} older segments outside the live window`;
    }
  }
  artTimer = setTimeout(pollArt, 750);
}
async function refreshCheckpoints() {
  const response = await command("checkpoints");
  if (response) $("checkpoint-list").replaceChildren(...response.result.map((row) => new Option(
    `${row.name === "latest.json" ? "Latest autosave" : "Saved run"} · ${new Date(row.savedAt).toLocaleString()}`, row.name)));
}
$("save-checkpoint").onclick = async () => {
  const response = await command("checkpoint");
  if (response) { $("storage-status").textContent = `Saved tick ${response.result.tick.toLocaleString()}.`; await refreshCheckpoints(); }
};
$("refresh-checkpoints").onclick = refreshCheckpoints;
$("restore-checkpoint").onclick = async () => {
  if (!$("checkpoint-list").value) return;
  selected = null;
  const response = await command("restore", { name: $("checkpoint-list").value });
  if (response) { $("storage-status").textContent = "Checkpoint restored and paused. Press Play to continue."; camera.fit(); }
};
$("preview-toggle").textContent = preview ? "Turn visualization off" : "Turn visualization on";
await client.poll({ selectedId: selected, view: preview });
await refreshCheckpoints();
await pollArt();
async function poll() {
  const started = performance.now();
  await client.poll({ selectedId: selected, view: preview && !document.hidden });
  pollTimer = setTimeout(poll, document.hidden ? 2000 : Math.max(0, 100 - (performance.now() - started)));
}
pollTimer = setTimeout(poll, 100);
window.addEventListener("pagehide", () => { clearTimeout(pollTimer); clearTimeout(artTimer); });
requestAnimationFrame(frame);
