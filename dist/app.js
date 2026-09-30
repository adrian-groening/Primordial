import { PlanetWorld } from "./sim/planet-world.js";
import { architecture, parameterCount } from "./sim/planet-neural.js";
import { bodyRadius, territoryRadius } from "./sim/space.js";
import { RADIUS } from "./sim/sphere.js";
import { GENES } from "./sim/genetics.js";
import { drawBrain } from "./brain-view.js";
import { PlanetView } from "./render/planet-view.js";
const $ = (id) => document.getElementById(id);
let sim = new PlanetWorld(),
  selected = sim.organisms[0].id,
  paused = matchMedia("(prefers-reduced-motion: reduce)").matches,
  speed = 1,
  last = 0,
  lastUI = 0,
  view = null;
try {
  view = new PlanetView($("world"), (id) => {
    selected = id;
    renderUI();
  });
} catch (error) {
  $("render-error").hidden = false;
  $("render-error").textContent =
    "The 3D view requires WebGL2. Enable graphics acceleration in VS Code, or use the previous 2D model linked below. " +
    error.message;
}
function resize() {
  view?.resize();
  for (const id of ["history", "brain"]) {
    const c = $(id),
      r = c.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      c.width = r.width * devicePixelRatio;
      c.height = r.height * devicePixelRatio;
    }
  }
}
new ResizeObserver(resize).observe($("viewport"));
resize();
const current = () => sim.organisms.find((o) => o.id === selected);
const pct = (v, max) => Math.max(0, Math.min(100, (v / max) * 100));
function trait(label, value) {
  return `<div class="trait"><span>${label}</span><b>${value}</b></div>`;
}
function choose(id, focus = false) {
  selected = id;
  const o = current();
  if (o && focus) view?.focus(o);
  renderUI();
}
function inspector() {
  const o = current(),
    record = sim.pedigree.get(selected);
  if (!record) {
    $("details").textContent =
      "Select an animal on the planet, or use Next animal.";
    $("dna").replaceChildren();
    $("family-content").replaceChildren();
    return;
  }
  const family = sim.families.get(record.familyId),
    dna = o?.dna ?? record.dna;
  $("details").innerHTML =
    `<div class="name">${family.name} · #${record.id}</div><div class="badges"><span class="badge">${record.role === "predator" ? "Hunter" : "Grazer"}</span><span class="badge">Asexual</span><span class="badge">Generation ${record.generation}</span><span class="badge">${record.variant}</span></div>`;
  if (o) {
    $("details").innerHTML +=
      trait(
        "Position · x, y, z (u)",
        o.n.map((v) => (v * RADIUS).toFixed(1)).join(", "),
      ) +
      trait(
        "Heading · unit vector",
        o.heading.map((v) => v.toFixed(3)).join(", "),
      ) +
      trait("Life stage", sim.mature(o) ? "Adult" : "Juvenile") +
      trait("Behavior", o.action) +
      trait("Body clearance radius", bodyRadius(o).toFixed(1) + " u") +
      trait("Territory radius", territoryRadius(o).toFixed(1) + " u") +
      trait("Age", o.age.toFixed(1) + " s") +
      trait("Energy", `${o.energy.toFixed(0)} / ${o.capacity}`) +
      `<div class="bar"><i style="width:${pct(o.energy, o.capacity)}%"></i></div>` +
      trait("Health", o.health.toFixed(0) + " / 100") +
      `<div class="bar"><i style="width:${pct(o.health, 100)}%"></i></div>` +
      trait(
        "Reproduction",
        sim.ready(o)
          ? "Ready — budding"
          : o.age < 18
            ? "Growing"
            : o.mateAfter > sim.tick
              ? "Recovering"
              : "Needs food / health",
      ) +
      trait(
        "Oxygen comfort",
        `${Math.max(0, o.traits.oxygen - o.traits.tolerance).toFixed(1)}–${(o.traits.oxygen + o.traits.tolerance).toFixed(1)}%`,
      ) +
      trait("Oxygen stress", sim.oxygenStress(o).toFixed(1)) +
      trait(
        "Mutated genes",
        o.mutations.length ? o.mutations.join(", ") : "None recorded",
      );
  } else
    $("details").innerHTML +=
      `<p class="note">Died from ${record.cause} at simulation time ${(record.deathTick / 30).toFixed(1)} s. Its pedigree and inherited DNA remain available.</p>`;
  $("dna").innerHTML = Object.entries(GENES)
    .map(([key, g]) => {
      const values = dna[key],
        mean = (values[0] + values[1]) / 2;
      return `<div class="dna-gene">${trait(g.label, mean.toFixed(key === "hue" ? 0 : 1) + g.unit)}<div class="alleles" aria-label="${g.label}: alleles ${values.map((v) => v.toFixed(2)).join(" and ")}"><span><i style="width:${pct(values[0] - g.min, g.max - g.min)}%"></i></span><span><i style="width:${pct(values[1] - g.min, g.max - g.min)}%"></i></span></div></div>`;
    })
    .join("");
  const button = (id) => {
    const r = sim.pedigree.get(id);
    return `<button data-id="${id}">${r?.sex ?? ""} #${id}${r?.deathTick !== null ? " †" : ""}</button>`;
  };
  const alive = sim.organisms.filter((x) =>
    x.ancestry.includes(record.familyId),
  ).length;
  $("family-content").innerHTML =
    `<div class="family-title">${family.name} lineage · ${alive} alive · ${family.births} descendants born</div><p class="note">Parents</p><div class="family-links">${record.parents.length ? record.parents.map(button).join("") : "Founder — no parents in this experiment"}</div><p class="note">${record.offspring.length} offspring${record.offspring.length > 12 ? " · latest 12 shown" : ""}</p><div class="family-links">${record.offspring.slice(-12).map(button).join("") || "No offspring yet"}</div><p class="note">Offspring bud asexually, inheriting their parent’s DNA with possible mutations. Aster and Cinder began with identical DNA. † marks a deceased animal.</p>`;
}
function chart() {
  const c = $("history"),
    ctx = c.getContext("2d"),
    w = c.width,
    h = c.height,
    d = devicePixelRatio;
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(
      10,
      ...sim.roleHistory.map((r) => Math.max(r.prey, r.predators)),
    ),
    left = 30 * d,
    bottom = 18 * d;
  ctx.fillStyle = "#85949e";
  ctx.font = `${10 * d}px monospace`;
  ctx.textAlign = "left";
  ctx.fillText(String(max), 0, 12 * d);
  ctx.fillText("0", 0, h - bottom);
  ctx.fillText(`${sim.roleHistory[0]?.time ?? 0}s`, left, h - 2 * d);
  ctx.textAlign = "right";
  ctx.fillText(`${Math.floor(sim.time)}s`, w, h - 2 * d);
  for (const [key, color] of [
    ["prey", "#a8cfa7"],
    ["predators", "#df9078"],
  ]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * d;
    ctx.beginPath();
    sim.roleHistory.forEach((r, i) => {
      const x =
          left + (i / Math.max(1, sim.roleHistory.length - 1)) * (w - left),
        y = h - bottom - (r[key] / max) * (h - bottom - 8 * d);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
}
function renderBrain() {
  const o = current();
  drawBrain($("brain"), o, Number($("network-view").value));
  $("brain-caption").textContent = o
    ? `${o.role === "predator" ? "Hunter" : "Grazer"} #${o.id} · ${sim.parameters} parameters`
    : "Select a living animal.";
  $("brain-readings").textContent = o?.brains.length
    ? `Turn ${o.control[0].toFixed(2)} · throttle ${((o.control[1] + 1) / 2).toFixed(2)} · attack ${o.control[2] > 0 ? "yes" : "no"} · mate/bud ${o.control[3] > 0 ? "yes" : "no"}`
    : "Rule-based foraging, escape and asexual budding.";
  $("brain-status").textContent =
    `Active: ${sim.neural.count} networks, ${sim.neural.depth} hidden layers, width ${sim.neural.width}.`;
}
function renderUI() {
  const predators = sim.organisms.filter((o) => o.role === "predator").length;
  for (const [id, value] of Object.entries({
    population: sim.organisms.length,
    "prey-count": sim.organisms.length - predators,
    "predator-count": predators,
    births: sim.births,
    "egg-count": sim.eggs.length,
    generation: Math.max(1, ...sim.organisms.map((o) => o.generation)),
    variants: sim.newVariants,
  }))
    $(id).textContent = value;
  $("time").textContent = Math.floor(sim.time) + " s";
  $("pause").textContent = paused ? "Play" : "Pause";
  $("status").textContent = paused
    ? "Paused"
    : sim.organisms.length || sim.eggs.length
      ? "Running"
      : "Extinct";
  $("ecology-note").textContent = sim.limitReached
    ? "Birth capacity reached; this run is capacity-limited."
    : `${sim.collisions} blocked movements · ${sim.conflicts} defensive strikes · ${sim.deaths.conflict} conflict deaths · ${sim.kills} predation deaths · ${sim.deaths.oxygen} oxygen deaths · ${sim.deaths.starvation} starvation deaths`;
  const mean = sim.organisms.length
    ? sim.organisms.reduce((n, o) => n + o.traits.oxygen, 0) /
      sim.organisms.length
    : null;
  $("oxygen-summary").textContent =
    `Mean inherited oxygen optimum: ${mean === null ? "—" : mean.toFixed(1) + "%"}. ${sim.deaths.oxygen} oxygen deaths.`;
  $("predator-status").textContent =
    `Two identical asexual founders: Aster and Cinder. Separate lineages diverge through mutation.`;
  $("lineage-comparison").innerHTML = [...sim.families.values()]
    .map((f) => {
      const living = sim.organisms.filter((o) => o.familyId === f.id);
      const mean = (key) =>
        living.length
          ? (
              living.reduce((sum, o) => sum + o.traits[key], 0) / living.length
            ).toFixed(2)
          : "—";
      return `<div class="lineage-card"><strong>${f.name}</strong>${trait("Living / births", `${living.length} / ${f.births}`)}${trait("Mean aggression", mean("aggression"))}${trait("Mean territory gene", mean("territory"))}${trait("Mean oxygen optimum", mean("oxygen"))}${trait("Mean hunting gene", mean("diet"))}</div>`;
    })
    .join("");
  inspector();
  chart();
  if (!$("panel-neural").hidden) renderBrain();
}
const config = () => ({
  count: Number($("networks").value),
  depth: Number($("depth").value),
  width: Number($("width").value),
});
function architectureUI() {
  const n = config();
  for (const id of ["networks", "depth", "width"])
    $(id + "-value").textContent = $(id).value;
  $("architecture").textContent = n.count
    ? `${n.count} × [${architecture(n).join(" → ")}] · ${parameterCount(n)} parameters`
    : "Rule-based behavior";
  $("depth").disabled = $("width").disabled = n.count === 0;
}
function restart(neural = sim.neural) {
  const env = { ...sim.environment },
    renewal = sim.renewal,
    mutation = sim.mutation;
  sim = new PlanetWorld(90210, neural, 2, env);
  sim.renewal = renewal;
  sim.mutation = mutation;
  selected = sim.organisms[0]?.id ?? null;
  renderUI();
}
$("pause").onclick = () => {
  paused = !paused;
  renderUI();
};
$("reset").onclick = () => restart();
document.querySelectorAll("[data-speed]").forEach(
  (b) =>
    (b.onclick = () => {
      speed = Number(b.dataset.speed);
      document.querySelectorAll("[data-speed]").forEach((x) => {
        x.classList.toggle("active", x === b);
        x.setAttribute("aria-pressed", String(x === b));
      });
    }),
);
for (const key of [
  "oxygen",
  "temperature",
  "seaLevel",
  "ruggedness",
  "fertility",
])
  $(key).oninput = () => {
    sim.setEnvironment(key, Number($(key).value));
    $(key + "-value").textContent =
      $(key).value + (key === "temperature" ? "°C" : "%");
    renderUI();
  };
for (const key of ["food", "mutation"])
  $(key).oninput = () => {
    sim[key === "food" ? "renewal" : "mutation"] = Number($(key).value);
    $(key + "-value").textContent = $(key).value + "%";
  };
$("restart-ancestor").onclick = () => restart();
for (const id of ["networks", "depth", "width"]) $(id).oninput = architectureUI;
$("apply-brain").onclick = () => {
  restart(config());
  $("network-view").replaceChildren(
    ...Array.from(
      { length: Math.max(1, sim.neural.count) },
      (_, i) => new Option(String(i + 1), String(i)),
    ),
  );
  renderBrain();
};
$("network-view").onchange = renderBrain;
$("inspect").onclick = () => {
  const i = sim.organisms.findIndex((o) => o.id === selected);
  choose(sim.organisms[(i + 1) % sim.organisms.length]?.id ?? null);
};
$("inspect-predator").onclick = () => {
  const list = sim.organisms.filter((o) => o.role === "predator"),
    i = list.findIndex((o) => o.id === selected);
  choose(list[(i + 1) % list.length]?.id ?? null, true);
};
$("family-content").onclick = (e) => {
  const b = e.target.closest("button[data-id]");
  if (b) choose(Number(b.dataset.id), true);
};
$("focus").onclick = () => view?.focus(current());
$("overview").onclick = () => view?.overview();
$("zoom-in").onclick = () => view?.zoom(0.8);
$("zoom-out").onclick = () => view?.zoom(1.25);
$("expand").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $("viewport").requestFullscreen();
    resize();
  } catch {
    $("expand").textContent = "Use editor maximize";
  }
};
document.querySelectorAll("[data-panel]").forEach(
  (b) =>
    (b.onclick = () => {
      for (const x of document.querySelectorAll("[data-panel]")) {
        const active = x === b;
        $("panel-" + x.dataset.panel).hidden = !active;
        x.classList.toggle("active", active);
        x.setAttribute("aria-selected", String(active));
      }
      resize();
      renderUI();
    }),
);
function frame(t) {
  const dt = last ? Math.min((t - last) / 1000, 0.06) : 0;
  last = t;
  if (!paused && dt > 0) sim.step(dt * speed);
  view?.render(sim, selected);
  if (t - lastUI > 250) {
    renderUI();
    lastUI = t;
  }
  requestAnimationFrame(frame);
}
architectureUI();
renderUI();
requestAnimationFrame(frame);
