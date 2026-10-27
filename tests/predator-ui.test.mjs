// DOM-adapter smoke test. This is not a browser visual/interaction test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalServer } from "../scripts/local-server.mjs";

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
    networks: "1",
    depth: "1",
    width: "6",
    predators: "8",
    "network-view": "0",
  }))
    elements.get(id).value = value;
  const speeds = [1, 3, 8, "max"].map((speed) => ({
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
  const nativeFetch = globalThis.fetch;
  const directory = await mkdtemp(join(tmpdir(), "primordial-ui-"));
  const server = createLocalServer(nativeFetch, { dataDirectory: directory });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  globalThis.fetch = (url, options) => nativeFetch(new URL(url, base), options);
  let pagehide;
  globalThis.window = { addEventListener(type, callback) { if (type === "pagehide") pagehide = callback; } };
  await server.simulation.request("playback", { paused: true });
  try {
  await import("../dist/predator-app.js");
  const $ = (id) => elements.get(id);
  assert.equal($("world").style.aspectRatio, "1200 / 800");
  assert.equal($("predator-count").textContent, 8);
  assert.equal($("prey-count").textContent, 80);
  await $("inspect-predator").onclick();
  assert.match($("details").innerHTML, /Predator/);
  assert.match($("details").innerHTML, /Health/);
  assert.match($("details").innerHTML, /Inherited markings/);
  assert.match($("details").innerHTML, /Inherited color/);
  for (let i = 1; i <= 90; i++) frame(i * 33.3333);
  const elapsedBeforeArchitecture = $("time").textContent;
  $("networks").value = "1";
  $("networks").oninput();
  assert.match($("architecture").textContent, /37 → 8 → 8 → 14/);
  await $("apply-brain").onclick();
  assert.equal($("time").textContent, elapsedBeforeArchitecture);
  assert.equal($("world").style.aspectRatio, "1200 / 800");
  await $("inspect-predator").onclick();
  for (let i = 91; i <= 120; i++) frame(i * 33.3333);
  assert.match($("brain-readings").textContent, /Attack:/);
  assert.match($("brain-caption").textContent, /Predator/);
  $("predators").value = "0";
  $("predators").oninput();
  await $("apply-predators").onclick();
  assert.equal($("predator-count").textContent, 0);
  assert.equal($("time").textContent, elapsedBeforeArchitecture);
  await $("inspect-predator").onclick();
  assert.match($("details").textContent, /No living predators/);
  await $("reset").onclick();
  await $("pause").onclick();
  assert.equal($("predator-count").textContent, 0);
  $("predators").value = "12";
  await $("apply-predators").onclick();
  assert.equal($("predator-count").textContent, 12);
  for (let i = 121; i <= 160; i++) frame(i * 33.3333);
  const elapsedBeforeResize = $("time").textContent;
  $("world-width").value = "800";
  $("world-height").value = "400";
  await $("apply-world").onclick();
  assert.equal($("world").style.aspectRatio, "800 / 400");
  assert.equal($("time").textContent, elapsedBeforeResize);
  $("world-height").value = "900";
  await $("world-height").onchange();
  assert.equal($("world").style.aspectRatio, "800 / 900");
  assert.equal($("time").textContent, elapsedBeforeResize);
  if ($("pause").textContent !== "Play") await $("pause").onclick();
  assert.equal($("pause").textContent, "Play");
  await $("skyfall").onclick();
  await new Promise((resolve) => setTimeout(resolve, 60));
  await $("pause").onclick();
  for (let i = 161; i <= 170; i++) frame(i * 33.3333);
  assert.match($("impact-status").textContent, /Skyfall at/);
  $("networks").value = "1";
  await $("apply-brain").onclick();
  await $("compare-food").onclick();
  assert.match($("decision-progress").textContent, /Comparing futures/);
  for (let i = 171; i <= 250; i++) frame(i * 33.3333);
  for (let attempt = 0; attempt < 100 && !$("decision-result").innerHTML; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.match($("decision-result").innerHTML, /Current food/);
  assert.match($("decision-result").innerHTML, /Tested food/);
  assert.equal($("apply-trial").hidden, false);
  await $("apply-trial").onclick();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal($("food").value, "80");
  assert.match($("engine-status").textContent, /ticks\/s/);
  await $("save-checkpoint").onclick();
  assert.match($("storage-status").textContent, /Saved tick/);
  assert($("checkpoint-list").options.length);
  await $("preview-toggle").onclick();
  assert.match($("view-status").textContent, /Visualization off/);
  } finally {
    pagehide?.();
    globalThis.fetch = nativeFetch;
    await server.simulation.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
