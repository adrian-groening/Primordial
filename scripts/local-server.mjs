import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, sep, extname } from "node:path";
import { SimulationService } from "./simulation-service.mjs";
import { BrainLabService } from "./brain-lab-service.mjs";
import { BrainObserverService } from "./brain-observer-service.mjs";
import { BrainControlService } from "./brain-control-service.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const MODEL = "llama2-uncensored:latest";
const OLLAMA = "http://127.0.0.1:11434";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};
let inFlight = false;
const field = (value, max = 180) =>
  typeof value === "string"
    ? value
        .replace(/[\x00-\x1f\x7f]+/g, " ")
        .slice(0, max)
        .trim()
    : "";
const json = (res, code, data) => {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
};

export function dialoguePrompt(input) {
  const speaker = field(input.speaker, 100),
    listener = field(input.listener, 100);
  const situation = field(input.situation, 300),
    prior = field(input.prior, 240);
  if (!speaker || !listener || !situation)
    throw new Error("Missing organism context");
  return [
    {
      role: "system",
      content:
        "You portray one fictional organism in a local artificial-life experiment. Speak directly to the other organism in one short, vivid sentence (maximum 30 words). Reflect your immediate bodily needs, danger, kinship, or territory. You may be wary, curious, friendly, or hostile. Do not claim to control simulation mechanics. Do not include stage directions, labels, roleplay markup, or explanations.",
    },
    {
      role: "user",
      content: `You are ${speaker}. Nearby is ${listener}. Situation: ${situation}.${prior ? ` The other organism just said: ${prior}` : ""} What do you say?`,
    },
  ];
}
export function cleanLine(value) {
  const cleaned = String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(?:[^:]{1,32}:\s*)/, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
  const sentence = cleaned.match(/^.{1,220}?[.!?](?=\s|$)/)?.[0] ?? cleaned;
  const limit = sentence.slice(0, 220);
  return limit.length < sentence.length ? limit.replace(/\s+\S*$/, "") : limit;
}
async function body(req, limit = 4096) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > limit) throw new Error("Request is too large");
  }
  return JSON.parse(text);
}
async function serveFile(res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return json(res, 400, { error: "Invalid path" });
  }
  const file = resolve(root, "." + (decoded === "/" ? "/index.html" : decoded));
  if (file !== root && !file.startsWith(root + sep))
    return json(res, 403, { error: "Forbidden" });
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("Not a file");
    const bytes = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(bytes);
  } catch {
    json(res, 404, { error: "Not found" });
  }
}
export function createLocalServer(fetcher = fetch, options = {}) {
  const brainLab = new BrainLabService(options.brainLab);
  const brainObserver = new BrainObserverService(async () => {
    await brainLab.ready;
    return { recording: brainLab.result, resultId: brainLab.resultId };
  }, fetcher, { auditFile: resolve(brainLab.root, "results/observer-log.ndjson"), ...options.brainObserver });
  const brainControl = new BrainControlService(brainLab, fetcher,
    { auditFile: resolve(brainLab.root, "results/controller-state.json"), ...options.brainControl });
  const simulation = new SimulationService(options.dataDirectory ??
    process.env.EVOLUTION_DATA_DIR ?? resolve(root, "../.simulation-data"));
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/api/brain/")) {
      const host = req.headers.host ?? "";
      if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host) ||
          (req.headers.origin && req.headers.origin !== `http://${host}`))
        return json(res, 403, { error: "Use Brain Lab on this local server" });
      try {
        if (["physical", "race"].includes(brainControl.active?.settings.mode)) {
          if (brainControl.active.settings.mode === "physical" && url.pathname === "/api/brain/observer/status" && req.method === "GET")
            return json(res, 200, { model: null, available: false, busy: false, readOnly: true, disabled: "Physical world has no LLM controller" });
          if (url.pathname === "/api/brain/observer/observe")
            return json(res, 409, { error: "LLM observation is disabled during physical-world operation" });
        }
        if (url.pathname === "/api/brain/control/live" && req.method === "GET") {
          const live = brainControl.getLive(url.searchParams.get("organism"));
          if (!live?.latest) return json(res, 404, { error: "No live activity window yet" });
          return json(res, 200, live.latest);
        }
        if (url.pathname === "/api/brain/control/communication" && req.method === "POST")
          return json(res, 200, await brainControl.communication(await body(req)));
        if (url.pathname === "/api/brain/control/status" && req.method === "GET")
          return json(res, 200, await brainControl.status());
        if (url.pathname === "/api/brain/control/start" && req.method === "POST")
          return json(res, 202, await brainControl.start(await body(req)));
        if (url.pathname === "/api/brain/control/stop" && req.method === "POST")
          return json(res, 200, await brainControl.cancel());
        if (url.pathname === "/api/brain/observer/status" && req.method === "GET")
          return json(res, 200, await brainObserver.status());
        if (url.pathname === "/api/brain/observer/log" && req.method === "GET")
          return json(res, 200, await brainObserver.log());
        if (url.pathname === "/api/brain/observer/observe" && req.method === "POST")
          return json(res, 200, await brainObserver.observe(await body(req)));
        if (url.pathname === "/api/brain/observer/cancel" && req.method === "POST")
          return json(res, 200, await brainObserver.cancel());
        if (url.pathname === "/api/brain/status" && req.method === "GET")
          return json(res, 200, await brainLab.status());
        if (url.pathname === "/api/brain/result" && req.method === "GET") {
          await brainLab.ready;
          if (!brainLab.result) return json(res, 404, { error: "No recording available yet" });
          return json(res, 200, { resultId: brainLab.resultId, recording: brainLab.result });
        }
        if (url.pathname === "/api/brain/run" && req.method === "POST")
          return json(res, 202, await brainLab.run(await body(req)));
        if (url.pathname === "/api/brain/cancel" && req.method === "POST")
          return json(res, 200, await brainLab.cancel());
        return json(res, 404, { error: "Unknown Brain Lab endpoint" });
      } catch (error) { return json(res, error.status ?? 400, { error: error.message }); }
    }
    if (url.pathname.startsWith("/api/simulation")) {
      const host = req.headers.host ?? "";
      if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host))
        return json(res, 403, { error: "Localhost access only" });
      if (req.headers.origin && req.headers.origin !== `http://${host}`)
        return json(res, 403, { error: "Use the control panel on this local server" });
      try {
        let reply;
        if (url.pathname === "/api/simulation" && req.method === "GET") {
          const selected = url.searchParams.get("selected");
          const selectedId = selected === null || selected === "" ? null : Number(selected);
          if (selectedId !== null && (!Number.isSafeInteger(selectedId) || selectedId < 1))
            return json(res, 400, { error: "Invalid organism ID" });
          reply = await simulation.request("snapshot", {
            selectedId, view: url.searchParams.get("view") !== "0",
          });
        } else if (url.pathname === "/api/simulation" && req.method === "POST") {
          const command = await body(req, 32768);
          const allowed = ["playback", "settings", "restart", "schedule", "raiseBudget", "inspect",
            "compare", "applyComparison", "discardComparison", "checkpoint", "checkpoints", "restore", "artSnapshot", "artExport"];
          if (!allowed.includes(command.action)) return json(res, 400, { error: "Unknown control action" });
          reply = await simulation.request(command.action, command.payload ?? {});
        } else return json(res, 404, { error: "Unknown simulation endpoint" });
        return json(res, 200, reply);
      } catch (error) { return json(res, simulation.failure ? 503 : 400, { error: error.message }); }
    }
    if (url.pathname === "/api/dialogue/status" && req.method === "GET") {
      if (["physical", "race"].includes(brainControl.active?.settings.mode)) return json(res, 200, { available: false, model: null });
      try {
        const response = await fetcher(`${OLLAMA}/api/tags`, {
          signal: AbortSignal.timeout(3000),
        });
        const data = await response.json();
        const available =
          response.ok && data.models?.some((m) => m.name === MODEL);
        return json(res, 200, { available: Boolean(available), model: MODEL });
      } catch {
        return json(res, 200, { available: false, model: MODEL });
      }
    }
    if (url.pathname === "/api/dialogue" && req.method === "POST") {
      if (["physical", "race"].includes(brainControl.active?.settings.mode)) return json(res, 409, { error: "Use the active experiment's controller for language interaction" });
      if (inFlight)
        return json(res, 429, { error: "The local model is speaking already" });
      let messages;
      try {
        messages = dialoguePrompt(await body(req));
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
      inFlight = true;
      try {
        const response = await fetcher(`${OLLAMA}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: MODEL,
            stream: false,
            messages,
            options: {
              num_predict: 48,
              num_ctx: 2048,
              temperature: 0.84,
              top_p: 0.92,
            },
            keep_alive: "10m",
          }),
          signal: AbortSignal.timeout(90000),
        });
        const data = await response.json();
        if (!response.ok)
          return json(res, 502, {
            error: field(data.error, 200) || "Ollama request failed",
          });
        const line = cleanLine(data.message?.content);
        if (!line)
          return json(res, 502, { error: "The model returned an empty reply" });
        return json(res, 200, { line, model: MODEL });
      } catch (error) {
        return json(res, 503, {
          error:
            error.name === "TimeoutError"
              ? "The model timed out"
              : "Ollama is unavailable on localhost",
        });
      } finally {
        inFlight = false;
      }
    }
    if (req.method !== "GET" && req.method !== "HEAD")
      return json(res, 405, { error: "Method not allowed" });
    return serveFile(res, url.pathname);
  });
  server.simulation = simulation;
  server.brainLab = brainLab;
  server.brainObserver = brainObserver;
  server.brainControl = brainControl;
  server.on("close", () => {
    simulation.close().catch((error) => console.error(error.message));
    brainLab.close().catch((error) => console.error(error.message));
    brainObserver.close().catch((error) => console.error(error.message));
    brainControl.close().catch((error) => console.error(error.message));
  });
  return server;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.EVOLUTION_PORT ?? 4173);
  const server = createLocalServer();
  server.listen(port, "127.0.0.1", () =>
    console.log(`Evolution lab: http://127.0.0.1:${port}/ · simulation runs locally outside the browser`));
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log("Saving simulation and stopping…");
    try {
      await server.brainControl.close();
      await Promise.all([server.simulation.close(), server.brainLab.close(), server.brainObserver.close()]);
    }
    catch (error) { console.error(`Could not save checkpoint: ${error.message}`); }
    server.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
