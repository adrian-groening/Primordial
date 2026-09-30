import { architecture, parameterCount, decide } from "./sim/predator-neural.js";
import { drawBrain } from "./brain-view.js";
import { PredatorWorld as Ecosystem } from "./sim/predator-world.js";
import { TickClock } from "./sim/tick-clock.js";
import { Camera2D } from "./render/camera2d.js";
import { appearanceFor } from "./render/phenotype2d.js";
import { beginFoodComparison, advanceFoodComparison, foodComparisonResult } from "./sim/decision-lab.js";
const $ = (id) => document.getElementById(id),
  canvas = $("world"),
  ctx = canvas.getContext("2d"),
  hc = $("history").getContext("2d");
let sim = new Ecosystem(),
  paused = matchMedia("(prefers-reduced-motion: reduce)").matches,
  speed = 1,
  selected = null,
  last = 0,
  ui = 0,
  backlog = 0,
  speedLimited = false,
  follow = false,
  achievedSpeed = 0,
  completedSinceUI = 0;
let comparison = null;
const playbackClock = new TickClock();
const camera = new Camera2D();
function setWorldAspect() {
  canvas.style.aspectRatio = `${sim.width} / ${sim.height}`;
}
function size() {
  for (const c of [canvas, $("history"), $("brain")]) {
    const r = c.getBoundingClientRect();
    c.width = Math.round(r.width * devicePixelRatio);
    c.height = Math.round(r.height * devicePixelRatio);
  }
}
new ResizeObserver(size).observe(canvas);
setWorldAspect();
size();
function draw() {
  const w = canvas.width,
    h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#05090b";
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  const target = follow && sim.organisms.find((o) => o.id === selected);
  if (target) camera.follow(target, w, h, sim.width, sim.height);
  const view = camera.transform(w, h, sim.width, sim.height);
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);
  ctx.fillStyle = "#05090b";
  ctx.fillRect(0, 0, sim.width, sim.height);
  ctx.strokeStyle = "#ffffff08";
  ctx.lineWidth = 1 / view.scale;
  for (let x = 25; x < sim.width; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, sim.height);
    ctx.stroke();
  }
  for (let y = 25; y < sim.height; y += 50) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(sim.width, y);
    ctx.stroke();
  }
  for (const obstacle of sim.obstacles) {
    ctx.fillStyle = "#1b2328";
    ctx.strokeStyle = "#82909c";
    ctx.beginPath();
    ctx.arc(obstacle.x, obstacle.y, obstacle.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  for (const f of sim.food) {
    ctx.fillStyle = "#a0a8b080";
    ctx.beginPath();
    ctx.arc(f.x, f.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const carcass of sim.carcasses) {
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
  for (const event of sim.events) {
    if (event.kind === "impact") {
      const progress = Math.min(1, (sim.tick - event.tick) / 45);
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
  for (const o of sim.organisms) {
    ctx.save();
    ctx.translate(o.x, o.y);
    const look = appearanceFor(o);
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
      Math.sin(sim.time * 5 + o.id) * 3,
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
  $("time").textContent = Math.floor(sim.time) + " s";
  $("population").textContent = sim.organisms.length;
  const predators = sim.organisms.filter((o) => o.role === "predator").length;
  $("predator-count").textContent = predators;
  $("prey-count").textContent = sim.organisms.length - predators;
  $("kill-count").textContent = sim.kills;
  $("predator-status").textContent =
    `Active: ${sim.initialPredators} founder predators. Changing this restarts the world.`;
  $("ecology-note").textContent = sim.limitReached
    ? `Technical ${sim.limitDiagnostic.store} limit (${sim.limitDiagnostic.budget}) at tick ${sim.limitDiagnostic.tick}; run paused and censored.`
    : `${sim.deaths.starvation} starvation deaths · ${sim.deaths.age} age deaths · ${sim.cannibalKills} cannibal kills · ${sim.carcasses.length} carcasses`;
  $("impact-status").textContent = sim.lastImpact
    ? `Skyfall at ${Math.floor(sim.lastImpact.tick / 30)} s · ${sim.lastImpact.casualties} organisms lost`
    : "A sudden impact can reshape the ecosystem.";
  $("skyfall").disabled = !!sim.limitDiagnostic;

  $("generation").textContent = sim.organisms.length
    ? Math.max(...sim.organisms.map((o) => o.generation))
    : "—";
  $("births").textContent = sim.births + " births";
  $("pause").textContent = paused ? "Play" : "Pause";
  $("status").textContent = paused
    ? sim.limitReached ? "Technical limit — run paused" : "Ecosystem paused"
    : sim.organisms.length
      ? `Ecosystem running · ${speed}× selected · ${achievedSpeed.toFixed(1)}× actual${speedLimited ? " · device limit" : ""}`
      : "Extinction — restart to reseed";
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
  const o = sim.organisms.find((o) => o.id === selected);
  if (o) {
    const look = appearanceFor(o);
    $("details").innerHTML =
      `<p style="color:hsl(${look.hue},${look.saturation}%,72%)">${o.role === "predator" ? "Predator" : "Prey"} #${o.id} <span style="float:right">Generation ${o.generation}</span></p><div class="energy"><div style="width:${(o.energy / o.capacity) * 100}%"></div></div><div class="trait">Reserve energy<b>${Math.round(o.energy)} / ${o.capacity} EU</b></div><div class="trait">Gut energy<b>${o.gutEnergy.toFixed(1)} / ${o.gutCapacity} EU</b></div><div class="trait">Health<b>${o.health.toFixed(1)} / ${o.maxHealth}</b></div><div class="trait">Stamina<b>${o.stamina.toFixed(1)} / ${o.maxStamina}</b></div><div class="trait">Behavior<b>${o.action}</b></div><div class="trait">Diet<b>${o.role === "predator" ? "Prey / carrion" : "Nutrients"}</b></div><div class="trait">Movement · tail length<b>${o.speed.toFixed(1)} LU/s</b></div><div class="trait">Sensing · feeler length<b>${Math.round(o.sense)} LU</b></div><div class="trait">Body size<b>${o.size.toFixed(1)} LU</b></div><div class="trait">Inherited color<b>${look.colorName}</b></div><div class="trait">Inherited markings<b>${look.markingCount}</b></div><div class="trait">Age<b>${Math.floor(o.age)} s</b></div>`;
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
  const result = foodComparisonResult(comparison);
  $("decision-progress").textContent = `Same start: ${comparison.start.prey} prey · ${comparison.start.predators} predators · 10-second comparison`;
  $("decision-result").innerHTML =
    `<p class="decision-result-line">Current food ${comparison.original}%: <b>${result.current.prey} prey</b> · ${result.current.predators} predators · ${result.current.food} food</p>` +
    `<p class="decision-result-line">Tested food ${comparison.proposed}%: <b>${result.trial.prey} prey</b> · ${result.trial.predators} predators · ${result.trial.food} food</p>` +
    `<p class="note">${result.message} This is one short simulated future, not a guaranteed outcome.</p>`;
  $("apply-trial").textContent = `Apply ${comparison.proposed}% food`;
  $("apply-trial").hidden = false;
  $("keep-current").hidden = false;
}
function clearComparison() { comparison = null; }
$("compare-food").onclick = () => {
  if (comparison || sim.limitDiagnostic) return;
  paused = true;
  backlog = 0;
  speedLimited = false;
  playbackClock.remainder = 0;
  comparison = beginFoodComparison(sim);
  renderUI();
};
$("apply-trial").onclick = () => {
  if (!comparison?.done || comparison.censored) return;
  sim.schedule({ type: "renewal", value: comparison.proposed, tick: sim.tick + 1 });
  $("food").value = String(comparison.proposed);
  $("food-value").textContent = comparison.proposed + "%";
  clearComparison();
  paused = false;
  renderUI();
};
$("keep-current").onclick = () => {
  clearComparison();
  paused = false;
  renderUI();
};
$("pause").onclick = () => {
  if (comparison) clearComparison();
  paused = !paused;
  renderUI();
};
$("skyfall").onclick = () => {
  if (sim.limitDiagnostic) return;
  clearComparison();
  sim.schedule({ type: "impact", tick: sim.tick + 1 });
  paused = false;
  renderUI();
};
document.querySelectorAll("[data-speed]").forEach(
  (b) =>
    (b.onclick = () => {
      speed = Number(b.dataset.speed);
      document
        .querySelectorAll("[data-speed]")
        .forEach((x) => x.classList.toggle("active", x === b));
    }),
);
for (const id of ["food", "mutation"])
  $(id).oninput = () => {
    clearComparison();
    sim.schedule({ type: id === "food" ? "renewal" : "mutation", value: Number($(id).value), tick: sim.tick + 1 });
    $(id + "-value").textContent = $(id).value + "%";
  };
$("inspect").onclick = () => {
  const i = sim.organisms.findIndex((o) => o.id === selected);
  selected = sim.organisms[(i + 1) % sim.organisms.length]?.id ?? null;
  renderUI();
};
function restart(neural = sim.neural, predators = sim.initialPredators, options = {
  width: sim.width, height: sim.height, boundary: sim.boundary,
  prey: sim.initialPrey, food: sim.initialFood, fovDegrees: sim.fovDegrees,
  budgets: sim.budgets,
}) {
  clearComparison();
  sim = new Ecosystem(90210, neural, predators, options);
  setWorldAspect();
  size();
  sim.renewal = Number($("food").value);
  sim.mutation = Number($("mutation").value);
  camera.fit();
  backlog = 0;
  speedLimited = false;
  completedSinceUI = 0;
  achievedSpeed = 0;
  playbackClock.remainder = 0;
  selected = null;
  $("details").innerHTML =
    "<p>No organism selected. Select one in the simulation to inspect its traits.</p>";
  renderUI();
}
$("reset").onclick = () => restart();
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
  renderUI();
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
$("follow-selected").onclick = () => { follow = !follow; $("follow-selected").textContent = follow ? "Stop following" : "Follow selected"; };
$("apply-world").onclick = () => { try { restart(sim.neural, sim.initialPredators, {
  width: Number($("world-width").value) || 1000,
  height: Number($("world-height").value) || 700,
  boundary: $("boundary").value || "reflect",
  prey: $("founder-prey").value === "" ? 80 : Number($("founder-prey").value),
  food: $("founder-food").value === "" ? 230 : Number($("founder-food").value),
  fovDegrees: Number($("fov").value) || 360,
  budgets: {
    organisms: Number($("organism-budget").value) || 350,
    food: Number($("food-budget").value) || 650,
    carcasses: Number($("carcass-budget").value) || 350,
  },
}); } catch (error) { $("world-error").textContent = error.message; } };
$("raise-budget").onclick = () => {
  if (!sim.limitDiagnostic) return;
  const store = sim.limitDiagnostic.store;
  const field = { organisms: "organism-budget", food: "food-budget", carcasses: "carcass-budget" }[store];
  try {
    sim.raiseBudget(store, Number($(field).value));
    paused = false;
    renderUI();
  } catch (error) { $("world-error").textContent = error.message; }
};
$("schedule-predators").onclick = () => {
  clearComparison();
  const count = Number($("introduction-count").value);
  const tick = Number($("introduction-tick").value);
  try {
    sim.schedule({ type: "introducePredators", value: count, tick });
    $("introduction-status").textContent = `${count} predators scheduled at tick ${tick}. Introduced energy is recorded as external input.`;
  } catch (error) { $("introduction-status").textContent = error.message; }
};
function frame(t) {
  const dt = last ? Math.max(0, (t - last) / 1000) : 0;
  last = t;
  if (dt > 1) { paused = true; backlog = 0; playbackClock.remainder = 0; }
  if (comparison && !comparison.done) {
    advanceFoodComparison(comparison, sim.neural.count ? 1 : 4);
    if (comparison.done) renderDecision();
    else $("decision-progress").textContent = `Comparing futures… ${Math.floor(comparison.ticks / comparison.horizon * 100)}%`;
  }
  if (!paused) {
    if (dt > 0) backlog += playbackClock.request(dt, speed);
    if (backlog > 30) { backlog = 30; speedLimited = true; }
    else if (backlog < 8) speedLimited = false;
    const work = Math.min(backlog, 8);
    const workStarted = performance.now();
    for (let i = 0; i < work; i++) {
      if (i && performance.now() - workStarted >= 12) break;
      if (!sim.stepTick()) { paused = true; backlog = 0; break; }
      backlog--;
      completedSinceUI++;
    }
  }
  draw();
  if (t - ui > 200) {
    achievedSpeed = completedSinceUI / ((t - ui) / 1000 * 30);
    completedSinceUI = 0;
    renderUI();
    ui = t;
  }
  requestAnimationFrame(frame);
}
document.addEventListener?.("visibilitychange", () => {
  if (document.hidden) {
    paused = true;
    backlog = 0;
    playbackClock.remainder = 0;
    renderUI();
  }
});
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
    ? "Apply & restart experiment"
    : "Restart with this architecture";
}
for (const id of ["networks", "depth", "width"])
  $(id).oninput = updateArchitecture;
$("apply-brain").onclick = () => {
  const c = pendingConfig();
  restart(c);
  $("network-view").replaceChildren(
    ...Array.from(
      { length: Math.max(1, c.count) },
      (_, i) => new Option(String(i + 1), String(i)),
    ),
  );
  selected = sim.organisms[0]?.id ?? null;
  updateArchitecture();
  renderUI();
};
function renderBrain() {
  const o = sim.organisms.find((o) => o.id === selected);
  const traced = o?.brains.length && o.lastInputs
    ? { ...o, traces: decide(o.brains, o.lastInputs).traces }
    : o;
  drawBrain($("brain"), traced, Number($("network-view").value));
  $("brain-status").textContent = sim.neural.count
    ? `Active: ${sim.neural.count} network(s), ${sim.neural.depth} hidden layer(s), width ${sim.neural.width}.`
    : "Active: rule-based hunting / escape (0 networks).";
  $("brain-caption").textContent = o
    ? o.brains.length
      ? `${o.role === "predator" ? "Predator" : "Prey"} #${o.id} · generation ${o.generation} · ${o.parameterCount} inherited parameters · decisions at 5 Hz`
      : `${o.role === "predator" ? "Predator" : "Prey"} #${o.id} uses rule-based hunting / escape. Set networks above zero and apply.`
    : "Select an organism to inspect its controller.";
  $("brain-readings").textContent = o?.brains.length
    ? `Turn: ${(o.control[0] * 3).toFixed(2)} rad/s · Throttle: ${Math.round(((o.control[1] + 1) / 2) * 100)}% · Attack: ${o.control[2] > 0 ? "requested" : "off"} · Feed: ${o.control[3] > 0 ? "requested" : "off"} · Reproduce: ${o.control[4] > 0 ? "requested" : "off"} · Controller energy cost: ${(o.parameterCount * 0.00015).toFixed(3)} EU/s`
    : "";
}
$("predators").oninput = () => {
  $("predators-value").textContent = $("predators").value;
};
$("apply-predators").onclick = () => {
  restart(sim.neural, Number($("predators").value));
  selected = sim.organisms.find((o) => o.role === "predator")?.id ?? null;
  renderUI();
};
$("inspect-predator").onclick = () => {
  const hunters = sim.organisms.filter((o) => o.role === "predator");
  const i = hunters.findIndex((o) => o.id === selected);
  selected = hunters[(i + 1) % hunters.length]?.id ?? null;
  if (selected === null)
    $("details").textContent =
      "No living predators. Change the founder count and restart to introduce them.";
  renderUI();
};
$("network-view").onchange = renderBrain;
updateArchitecture();
renderUI();
requestAnimationFrame(frame);
