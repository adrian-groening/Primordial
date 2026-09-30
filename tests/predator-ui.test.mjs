// DOM-adapter smoke test. This is not a browser visual/interaction test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("live page wires predator controls, restart, neural inspection and empty predator state", async () => {
  const html = readFileSync(
    new URL("../dist/index.html", import.meta.url),
    "utf8",
  );
  assert.equal(html, readFileSync(new URL("../dist/predator.html", import.meta.url), "utf8"));
  assert.match(html, /Body: size · Tail: speed · Feelers: sensing/);
  const elements = new Map();
  const ctx = new Proxy(
    {},
    {
      get: (target, key) => (key in target ? target[key] : () => {}),
      set: (target, key, value) => ((target[key] = value), true),
    },
  );
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
    assert(!elements.has(id), `Duplicate id ${id}`);
    elements.set(id, {
      value: "",
      textContent: "",
      innerHTML: "",
      width: 800,
      height: 400,
      style: {},
      disabled: false,
      getContext: () => ctx,
      getBoundingClientRect: () => ({
        width: 800,
        height: 400,
        left: 0,
        top: 0,
      }),
      replaceChildren(...options) {
        this.options = options;
        this.value = options[0]?.value ?? "";
      },
    });
  }
  for (const [id, value] of Object.entries({
    food: "60",
    mutation: "12",
    networks: "0",
    depth: "1",
    width: "6",
    predators: "8",
    "network-view": "0",
  }))
    elements.get(id).value = value;
  const speeds = [1, 3, 8].map((speed) => ({
    dataset: { speed: String(speed) },
    classList: { toggle() {} },
  }));
  let frame;
  globalThis.document = {
    getElementById: (id) => {
      assert(elements.has(id), `Missing ${id}`);
      return elements.get(id);
    },
    querySelectorAll: (selector) => {
      assert.equal(selector, "[data-speed]");
      return speeds;
    },
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
  globalThis.requestAnimationFrame = (callback) => {
    frame = callback;
  };
  await import("../dist/predator-app.js");
  const $ = (id) => elements.get(id);
  assert.equal($("world").style.aspectRatio, "1000 / 700");
  assert.equal($("predator-count").textContent, 8);
  assert.equal($("prey-count").textContent, 80);
  $("inspect-predator").onclick();
  assert.match($("details").innerHTML, /Predator/);
  assert.match($("details").innerHTML, /Health/);
  assert.match($("details").innerHTML, /Inherited markings/);
  assert.match($("details").innerHTML, /Inherited color/);
  for (let i = 1; i <= 90; i++) frame(i * 33.3333);
  $("networks").value = "1";
  $("networks").oninput();
  assert.match($("architecture").textContent, /23 → 6 → 5/);
  $("apply-brain").onclick();
  $("inspect-predator").onclick();
  for (let i = 91; i <= 120; i++) frame(i * 33.3333);
  assert.match($("brain-readings").textContent, /Attack:/);
  assert.match($("brain-caption").textContent, /Predator/);
  $("predators").value = "0";
  $("predators").oninput();
  $("apply-predators").onclick();
  assert.equal($("predator-count").textContent, 0);
  $("inspect-predator").onclick();
  assert.match($("details").textContent, /No living predators/);
  $("reset").onclick();
  assert.equal($("predator-count").textContent, 0);
  $("predators").value = "12";
  $("apply-predators").onclick();
  assert.equal($("predator-count").textContent, 12);
  $("world-width").value = "800";
  $("world-height").value = "400";
  $("apply-world").onclick();
  assert.equal($("world").style.aspectRatio, "800 / 400");
  $("pause").onclick();
  assert.equal($("pause").textContent, "Play");
  $("skyfall").onclick();
  for (let i = 121; i <= 130; i++) frame(i * 33.3333);
  assert.match($("impact-status").textContent, /Skyfall at/);
  $("networks").value = "0";
  $("apply-brain").onclick();
  $("compare-food").onclick();
  assert.match($("decision-progress").textContent, /Comparing futures/);
  for (let i = 131; i <= 210; i++) frame(i * 33.3333);
  assert.match($("decision-result").innerHTML, /Current food/);
  assert.match($("decision-result").innerHTML, /Tested food/);
  assert.equal($("apply-trial").hidden, false);
  $("apply-trial").onclick();
  assert.equal($("food").value, "80");
});
