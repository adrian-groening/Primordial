// DOM wiring and graceful no-WebGL fallback, not a visual-browser test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("planet page controls atmosphere, mating inspection, DNA, tabs and neural settings", async () => {
  const html = readFileSync(
      new URL("../dist/planet.html", import.meta.url),
      "utf8",
    ),
    elements = new Map();
  const ctx = new Proxy(
    {},
    {
      get: (t, k) => (k in t ? t[k] : () => {}),
      set: (t, k, v) => ((t[k] = v), true),
    },
  );
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
    assert(!elements.has(id));
    elements.set(id, {
      value: "",
      textContent: "",
      innerHTML: "",
      hidden:
        id === "render-error" ||
        id === "panel-environment" ||
        id === "panel-neural",
      width: 800,
      height: 400,
      style: {},
      getContext: (type) => (type === "2d" ? ctx : null),
      getBoundingClientRect: () => ({
        width: 800,
        height: 400,
        left: 0,
        top: 0,
      }),
      addEventListener() {},
      setAttribute() {},
      replaceChildren(...options) {
        this.options = options;
        this.innerHTML = "";
        this.value = options[0]?.value ?? "";
      },
    });
  }
  for (const [id, v] of Object.entries({
    oxygen: 21,
    temperature: 24,
    seaLevel: 38,
    ruggedness: 55,
    fertility: 70,
    food: 60,
    mutation: 12,
    networks: 0,
    depth: 1,
    width: 6,
    "network-view": 0,
  }))
    elements.get(id).value = String(v);
  const buttons = (key, values) =>
      values.map((v) => ({
        dataset: { [key]: String(v) },
        classList: { toggle() {} },
        setAttribute() {},
      })),
    speeds = buttons("speed", [1, 3, 8]),
    tabs = buttons("panel", ["organism", "environment", "neural"]);
  let frame;
  globalThis.document = {
    getElementById: (id) => {
      assert(elements.has(id), id);
      return elements.get(id);
    },
    querySelectorAll: (s) => (s === "[data-speed]" ? speeds : tabs),
  };
  globalThis.devicePixelRatio = 1;
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.ResizeObserver = class {
    observe() {}
  };
  globalThis.Option = class {
    constructor(label, value) {
      this.label = label;
      this.value = value;
    }
  };
  globalThis.requestAnimationFrame = (fn) => {
    frame = fn;
  };
  const oldError = console.error;
  console.error = () => {};
  try {
    await import("../dist/app.js");
  } finally {
    console.error = oldError;
  }
  const $ = (id) => elements.get(id);
  assert.equal($("population").textContent, 2);
  assert.match($("details").innerHTML, /Asexual/);
  assert.match($("dna").innerHTML, /Oxygen tolerance/);
  assert.match($("details").innerHTML, /Position · x, y, z/);
  assert.match($("details").innerHTML, /Heading · unit vector/);
  assert.match($("family-content").innerHTML, /Founder/);
  assert.equal($("render-error").hidden, false);
  tabs[1].onclick();
  assert.equal($("panel-environment").hidden, false);
  $("oxygen").value = "40";
  $("oxygen").oninput();
  assert.equal($("oxygen-value").textContent, "40%");
  $("seaLevel").value = "60";
  $("seaLevel").oninput();
  assert.equal($("seaLevel-value").textContent, "60%");
  $("inspect-predator").onclick();
  assert.match($("details").innerHTML, /Grazer/);
  tabs[2].onclick();
  $("networks").value = "1";
  $("networks").oninput();
  assert.match($("architecture").textContent, /14 → 6 → 4/);
  $("apply-brain").onclick();
  for (let i = 1; i <= 10; i++) frame(i * 33.33);
  assert.match($("brain-readings").textContent, /mate/);
  $("restart-ancestor").onclick();
  assert.equal($("population").textContent, 2);
  assert.equal($("predator-count").textContent, 0);
  $("pause").onclick();
  assert.equal($("pause").textContent, "Play");
});
