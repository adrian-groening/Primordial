import { validateRecording, indexSpikeTimes, recentSpike, comparison } from "./brain-lab-data.js";
import { BrainObserverController } from "./brain-observer.js";
import { BrainBodyView } from "./brain-body-view.js";
import { renderFoodRace } from "./brain-race-view.js";

const $ = (id) => document.getElementById(id);
const fmt = (value) => Number(value).toLocaleString("en-US");
const state = { recording: null, resultId: null, condition: "sugar", time: 0, playing: true,
  selected: null, positions: new Map(), spikeTimes: new Map(), busy: false, polling: false };
state.organism = "a";
const colors = { mint: "#9ed9c1", copper: "#d9ae7b", muted: "#738884", purple: "#b4819f" };
const observer = new BrainObserverController(api, renderObserver);
let observerLogSignature = "";
let controlSnapshot = null, controlPending = false, controlLogSignature = "", brainStatus = null;
let controlRequestError = null;
let messageSignature = "";
const circuit = $("circuit"), raster = $("raster"), rasterImage = document.createElement("canvas");
const bodyView = new BrainBodyView($("body-world"), async (id) => { state.organism = id; renderControl(); await refresh(); });
let circuitSize = { width: 1, height: 1 }, rasterSize = { width: 1, height: 1 };

async function api(path, body) {
  const response = await fetch(`/api/brain/${path}`, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Local model request failed");
  return value;
}
function showError(id, message) { $(id).textContent = message ?? ""; $(id).hidden = !message; }
function condition() { return state.recording?.conditions.find((trial) => trial.key === state.condition); }
function element(tag, text, className) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
  if (className) node.className = className; return node;
}
function setPlaying(playing) {
  state.playing = playing; $("play").textContent = playing ? "Pause" : "Play";
  $("play").setAttribute("aria-label", playing ? "Pause spike playback" : "Play recorded spikes");
}
function selectCondition(key) {
  if (state.recording?.schema === "brain-live-v1" && key !== "sugar") return;
  state.condition = key;
  for (const button of document.querySelectorAll("[data-condition]")) button.setAttribute("aria-pressed", String(button.dataset.condition === key));
  if (!state.recording) return;
  state.spikeTimes = indexSpikeTimes(condition());
  const descriptions = {
    sugar: `${state.recording.rate_hz} Hz sugar-sensor stimulation. Original outgoing connections are intact.`,
    sugar_disconnected: "Identical seeded input. Outgoing sensor weights are zero; stimulated sensors can still spike.",
    baseline: "External input is off. The reference model assumes zero basal firing, so a silent baseline is expected.",
    sugar_repeat: "Intact trial repeated from the same initial neural state and random seed.",
  };
  $("condition-description").textContent = state.recording.schema === "brain-live-v1" ?
    `Live window ${state.recording.sequence} · ${state.recording.start_ms.toFixed(0)}–${state.recording.end_ms.toFixed(0)} ms · ${state.recording.rate_hz} Hz input. Neural state continues across windows.` : descriptions[key];
  const trial = condition();
  $("raster-count").textContent = `${fmt(trial.events.length)} marks`;
  $("raster-note").textContent = `${fmt(trial.total_spikes)} spikes in the full model · ${fmt(trial.selected_spike_count)} in the displayed subset.${trial.events_sampled ? " Raster is sampled to 100,000 marks; counts remain exact." : " Every recorded spike in this subset is shown."} Same neuron rows across conditions.`;
  renderInspector(); renderRaster();
  observer.select(observerSelection(), true);
}
function selectNeuron(index) {
  if (!state.recording?.nodes.some((node) => node.index === index)) return;
  state.selected = index; $("neuron-select").value = String(index); renderInspector(); renderRaster();
  observer.select(observerSelection());
}
function observerSelection() {
  if (state.recording?.schema === "brain-live-v1") return null;
  return { resultId: state.resultId, condition: state.condition,
    neuronId: state.recording?.nodes.find((node) => node.index === state.selected)?.id ?? null };
}
function renderObserver() {
  const current = observer.current;
  const live = state.recording?.schema === "brain-live-v1";
  $("observer-auto").disabled = live;
  $("explain-condition").disabled = live || !state.recording || !observer.available || observer.busy || observer.remoteBusy;
  $("cancel-observation").hidden = !observer.busy && !observer.remoteBusy;
  $("observer-status").textContent = live ? "Live decisions are explained in the control log. The separate observer reads paired recordings." : observer.busy || observer.remoteBusy ?
    "Local Llama 2 is generating commentary…" : observer.available ?
      "llama2-uncensored:latest · local · read only" : "Local model unavailable · start Ollama to use the observer";
  showError("observer-error", observer.error ?? observer.auditError);
  renderControl();
  $("observer-commentary").textContent = current?.commentary ?? (observer.busy ?
    "Commentary is pending. Responses stay attached to the recording and condition that requested them." :
    "No commentary for this selection yet. Ask the observer to explain the recorded response.");
  $("observer-binding").textContent = current ?
    `${current.condition} · ${current.resultId} · seed ${current.context.parameters.seed} · ${current.context.parameters.duration_ms} ms · ${current.context.parameters.effective_stimulation_hz} Hz input` : "";
  $("export-observer-log").disabled = observer.entries.length === 0;
  const signature = observer.entries.map((entry) => `${entry.id}:${entry.status}`).join("|");
  if (signature === observerLogSignature) return;
  observerLogSignature = signature;
  const log = $("observer-log"); log.replaceChildren();
  for (const entry of observer.entries.slice(0, 8)) {
    const details = element("details", undefined, "observer-log-entry"), summary = element("summary");
    const time = new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    summary.textContent = `${time} · ${entry.condition} · ${entry.status}`;
    const binding = element("p", `${entry.resultId} · neuron ${entry.neuronId ?? "none"}`, "fine mono");
    const text = element("p", entry.commentary ?? entry.error ?? "Generating commentary…", "logged-commentary");
    const context = element("details"), contextTitle = element("summary", "Recorded facts supplied");
    const facts = element("pre", JSON.stringify(entry.context, null, 2)); context.append(contextTitle, facts);
    const prompt = element("details"), promptTitle = element("summary", "Exact local model request");
    prompt.append(promptTitle, element("pre", JSON.stringify(entry.request, null, 2)));
    const hash = element("p", `Input SHA-256 ${entry.contextHash}`, "fine mono");
    details.append(summary, binding, text, context, prompt, hash); log.append(details);
  }
  if (!observer.entries.length) log.append(element("p", "No observations yet.", "fine"));
}
function renderControl() {
  const session = controlSnapshot?.session, active = Boolean(controlSnapshot?.active || brainStatus?.controlSessionId);
  if (active && session) {
    $("control-mode").value = session.settings.mode ?? "paired";
    $("control-interval").value = String(session.settings.interval_ms ?? 5000);
    $("control-target").value = String(session.settings.target_spikes_per_second);
    $("control-rounds").value = String(session.settings.rounds);
    $("control-duration").value = String(session.settings.duration_ms);
    $("control-seed").value = String(session.settings.seed);
    $("race-duration").value = String(session.settings.game_seconds ?? 60);
    $("race-horizon").value = String(session.settings.plan_seconds ?? 2);
    $("race-swap").checked = session.settings.swap_sides ?? false;
  }
  const physical = $("control-mode").value === "physical";
  const race = $("control-mode").value === "race", worldMode = physical || race;
  for(const id of ["race-duration-label","race-horizon-label","race-swap-label"]) $(id).hidden = !race;
  $("control-rounds-label").hidden = $("control-mode").value !== "paired";
  $("control-interval-label").hidden = worldMode || $("control-mode").value === "paired";
  $("control-target-label").hidden = worldMode;
  $("control-llm-notes").hidden = worldMode;
  $("observer-panel").hidden = worldMode;
  $("control-label").textContent = physical ? "SENSORY / NEURAL / MOTOR" : "LLM / CLOSED LOOP";
  $("control-title").textContent = race ? "Food race settings" : physical ? "Physical neural control" : "Let the model drive the input";
  $("control-badge").textContent = race ? "LLM GOAL CONTROL" : physical ? "NO LLM" : "INPUT CONTROL";
  $("control-intro").textContent = race ? "Each LLM controller chooses a food target and pace. Both plans apply together. Navigation, neural motor drive and physical constraints execute the actions." : physical ? "Two intact FlyWire networks run in lockstep with the world. Each neural step receives current sensory input before the body moves." : "Llama 2 reads neural activity and chooses its next input.";
  $("control-history-note").textContent = physical ? "Neural state carries forward while bodies move, eat and collide. Recent physical steps are bounded to 40; trails to 240 positions. Reloading reconnects. A new session initializes new brains and bodies. Compute is slower than real time." : "Continuous modes run until Stop. Model wording may be inaccurate; measured counters remain the evidence. Reloading reconnects; server restarts leave control stopped.";
  $("start-control").textContent = race ? "Start food race ↗" : physical ? "Start physical world ↗" : "Start LLM control ↗";
  $("stop-control").textContent = race ? "Stop food race" : physical ? "Stop physical world" : "Stop LLM control";
  $("start-control").disabled = controlPending || active || state.busy || !state.recording || !brainStatus?.available || (!physical && !observer.available);
  $("stop-control").hidden = !active;
  $("stop-control").disabled = controlPending || session?.state === "stopping";
  for (const input of $("control-form").querySelectorAll("input,select")) input.disabled = active || controlPending;
  $("export-control-log").disabled = !session;
  if (brainStatus) {
    $("run-experiment").disabled = state.busy || active || !brainStatus.available;
    $("cancel-experiment").hidden = !state.busy || active;
    if (active) $("run-status").textContent = physical ? "Physical world owns both brains · Stop ends the session" : "LLM control owns the brain · use Stop LLM control to return to manual experiments";
  }
  const step = session?.steps.at(-1);
  const isRaceSession = session?.settings.mode === "race";
  const isBodySession = ["physical","race"].includes(session?.settings.mode);
  const continuous = ["continuous", "duo", "physical","race"].includes(session?.settings.mode);
  const viewLive = selectedLive(controlSnapshot);
  const thinking = controlSnapshot?.organisms?.find((agent) => agent.state === "thinking");
  $("control-status").textContent = isBodySession ? `${session.state.toUpperCase()} · ${isRaceSession ? 'LLM FOOD RACE' : 'NO LLM'} · physics step ${controlSnapshot.world?.step ?? 0} · ${session.error ?? session.reason ?? viewLive?.progress ?? "Building neural networks"}` : session ?
    `${session.state.toUpperCase()} · ${continuous ? `continuous · decision ${session.decisionCount ?? 0}` : `round ${session.steps.length}/${session.settings.rounds}`} · ${
      session.state === "thinking" ? `Llama 2 is choosing for ${thinking?.name ?? "the brain"}… Neural activity continues.` :
      session.state === "running" ? continuous ? viewLive?.progress ?? "Building persistent network…" : `${step?.decision?.rate_hz} Hz applied · ${brainStatus?.progress ?? "running brain"}` :
      session.state === "stopping" ? "Stopping generation and the owned experiment…" : session.reason}` :
    physical ? "Physical world ready · brain environment required · no language model" : observer.available ? "Local Llama 2 ready · choose a target and start" : "Start Ollama with llama2-uncensored:latest to enable control";
  showError("control-error", controlRequestError ?? session?.error ?? session?.warning ?? controlSnapshot?.auditError);
  renderOrganisms();
  renderTrend(viewLive?.samples ?? [], isBodySession ? undefined : session?.settings.target_spikes_per_second);
  const feedback = $("control-feedback"), log = $("control-log"); feedback.replaceChildren();
  if (!session) {
    if (controlLogSignature !== "empty") { log.replaceChildren(element("p", "No control session yet.", "fine")); controlLogSignature = "empty"; }
    return;
  }
  const lastSample = continuous ? viewLive?.samples?.at(-1) : null;
  const latest = lastSample ? { downstream_spikes_per_second: lastSample.spikes_per_second, rate_hz: lastSample.rate_hz } :
    [...session.steps].reverse().find((entry) => entry.outcome)?.outcome ?? session.initial;
  const metrics = isBodySession ? [["WORLD TIME", `${(controlSnapshot.world?.time ?? 0).toFixed(2)} s`], ["NEURAL STEP", `${session.settings.duration_ms} ms`], ["LANGUAGE MODEL", isRaceSession ? "ON" : "OFF"]] : [["TARGET · SPIKES/S", fmt(session.settings.target_spikes_per_second)],
    ["LATEST MEASURED · SPIKES/S", fmt(Math.round(latest.downstream_spikes_per_second))],
    ["LATEST MEASURED INPUT", `${latest.rate_hz} Hz`]];
  for (const [label, value] of metrics) {
    const cell = element("div"); cell.append(element("span", label), element("strong", value)); feedback.append(cell);
  }
  const signature = JSON.stringify(session);
  if (signature === controlLogSignature) return;
  controlLogSignature = signature; log.replaceChildren();
  log.append(element("p", `Session ${session.id} · seed ${session.settings.seed} · ${session.settings.duration_ms} ms per trial`, "fine mono"));
  log.append(element("p", `Starting measurement: ${fmt(session.initial.downstream_spikes_per_second)} spikes/s at ${session.initial.rate_hz} Hz over ${session.initial.duration_ms} ms.`, "fine"));
  for (const entry of [...session.steps].reverse()) {
    const details = element("details", undefined, "observer-log-entry");
    if (isBodySession) {
      details.append(element("summary", `Physical step ${entry.worldStep} · ${entry.worldTime.toFixed(2)} s · measured motor outputs`),
        element("pre", JSON.stringify(entry,null,2))); log.append(details); continue;
    }
    details.open = entry.state !== "complete" || entry === session.steps.at(-1);
    details.append(element("summary", `${entry.organismId ? `Organism ${entry.organismId.toUpperCase()} · turn ${entry.organismTurn}` : `Round ${entry.round}`} · ${entry.decision ? `${entry.decision.rate_hz} Hz` : "awaiting decision"} · ${entry.state}`));
    if (entry.decision) {
      details.append(element("span", "GENERATED RATIONALE", "eyebrow"));
      details.append(element("p", entry.decision.rationale, "logged-commentary"));
    }
    if (entry.outcome) {
      details.append(element("p", `Measured ${fmt(entry.outcome.downstream_spikes)} downstream spikes / ${entry.outcome.duration_ms} ms = ${fmt(entry.outcome.downstream_spikes_per_second)} spikes/s. Target error: ${fmt(entry.targetError)} spikes/s.`, "control-result"));
      details.append(element("p", `Recording ${entry.outcome.resultId}`, "fine mono"));
    } else details.append(element("p", entry.error ?? "No completed outcome for this round.", "fine"));
    const evidence = element("details"); evidence.append(element("summary", "Exact request, reply and applied settings"),
      element("pre", JSON.stringify({ organismId: entry.organismId, receivedMessageIds: entry.receivedMessageIds,
        messageId: entry.messageId, request: entry.request, rawReply: entry.rawReply,
        appliedSettings: entry.appliedSettings, jobId: entry.jobId, outcome: entry.outcome }, null, 2)));
    details.append(evidence); log.append(details);
  }
}
function selectedLive(snapshot) {
  return snapshot?.organisms?.length ? snapshot.organisms.find((agent) => agent.id === state.organism) : snapshot?.live;
}
function makeOrganismCard(id) {
  const card = element("article", undefined, `organism-card organism-${id}`); card.id = `organism-${id}`;
  const header = element("div", undefined, "organism-header");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 80"); svg.setAttribute("aria-hidden", "true");
  const points = [[22,40],[38,21],[38,59],[61,26],[61,54],[79,40]];
  for (const [a,b] of [[0,1],[0,2],[1,3],[1,4],[2,3],[2,4],[3,5],[4,5]]) {
    const line = document.createElementNS(svg.namespaceURI,"line");
    for (const [key,value] of Object.entries({x1:points[a][0],y1:points[a][1],x2:points[b][0],y2:points[b][1]})) line.setAttribute(key,String(value)); svg.append(line);
  }
  for (const [x,y] of points) { const circle = document.createElementNS(svg.namespaceURI,"circle"); circle.setAttribute("cx",x); circle.setAttribute("cy",y); circle.setAttribute("r",4); svg.append(circle); }
  const title = element("div"); title.append(element("h3", `Organism ${id.toUpperCase()}`));
  const status = element("p", "Waiting to start", "fine"); status.id = `organism-${id}-state`; title.append(status); header.append(svg,title);
  const metrics = element("p", "—", "organism-metrics"); metrics.id = `organism-${id}-metrics`;
  const seed = element("p", "Same wiring · independent state", "fine mono"); seed.id = `organism-${id}-seed`;
  const last = element("p", "No message sent yet.", "organism-last"); last.id = `organism-${id}-last`;
  const inspect = element("button", "Inspect this brain ↓", "quiet"); inspect.id = `inspect-organism-${id}`;
  inspect.addEventListener("click", async () => { state.organism = id; controlLogSignature = ""; renderControl(); await refresh(); $("circuit-title").scrollIntoView({ block: "start", behavior: "smooth" }); });
  card.append(header,metrics,seed,last,inspect); $("organism-cards").append(card);
}
function renderOrganisms() {
  const session = controlSnapshot?.session, duo = session?.settings.mode === "duo", active = Boolean(controlSnapshot?.active);
  const race = session?.settings.mode === "race" || (!active && $("control-mode").value === "race");
  const noLlm = session?.settings.mode === "physical" || (!active && $("control-mode").value === "physical");
  const physical = race || noLlm;
  renderFoodRace(session?.settings.mode === "race" ? session.game : null, controlSnapshot?.world);
  $("physical-world").hidden = !physical;
  $("organism-messages").hidden = physical;
  $("organism-language-note").hidden = physical;
  $("organisms-label").textContent = race ? "LLM / PHYSICAL FOOD COMPETITION" : physical ? "TWO ORGANISMS / PHYSICAL ARENA" : "TWO ORGANISMS / SHARED CHANNEL";
  $("organisms-title").textContent = race ? "Two flies. One food race." : physical ? "Bodies in a physical world." : "Separate brains. A conversation.";
  $("organisms-badge").textContent = race ? "LLM CONTROL" : physical ? "LLM OFF" : "LOCAL LLAMA 2";
  $("organisms-intro").textContent = race ? "Llama 2 chooses each fly's target and pace. Compare its stated plans and forecasts with food actually collected." : physical ? "Chemical gradients become sensory input. Recorded neural spikes drive two virtual bodies through a solid arena." : "Two neural agents share reference wiring, with separate states and clocks. Each controller reads its own activity and delivered messages.";
  bodyView.update(physical ? controlSnapshot?.world : null, active, session?.id);
  for (const id of ["a","b"]) {
    if (!$(`organism-${id}`)) makeOrganismCard(id);
    const agent = controlSnapshot?.organisms?.find((agent) => agent.id === id);
    const previous = session?.agents?.find((agent) => agent.id === id);
    $(`organism-${id}`).classList.toggle("selected", (duo || physical) && state.organism === id);
    $(`organism-${id}-state`).textContent = agent ? `${agent.state} · ${agent.progress}` : previous ? "Stopped · restart initializes a new brain" : "Waiting to start";
    $(`organism-${id}-metrics`).textContent = agent?.measured ? `${fmt(agent.measured.downstream_spikes_per_second)} spikes/s · ${agent.measured.rate_hz} Hz input · ${(agent.measured.end_ms/1000).toFixed(2)} s simulated` : "No measured activity yet";
    $(`organism-${id}-seed`).textContent = `Same reference wiring · seed ${agent?.seed ?? previous?.seed ?? ((Number($("control-seed").value) + (id === "b" ? 1 : 0)) >>> 0)}`;
    const last = duo ? session.messages?.filter((message) => message.sender === id && message.delivered).at(-1) : null;
    const body = physical ? controlSnapshot?.world?.bodies.find(body=>body.id===id) : null;
    $(`organism-${id}-last`).textContent = body ? `${body.mind?.intent ?? 'active'} — ${body.mind?.reason ?? ''}. Energy ${body.energy.toFixed(1)}% · fatigue ${((body.mind?.fatigue ?? 0)*100).toFixed(0)}% · meals ${body.meals} · contacts ${body.contacts}.` : last ? `Last sent: “${last.text}”` : physical ? "Waiting for embodied neural activity…" : "No delivered message yet.";
    $(`inspect-organism-${id}`).disabled = !agent?.latestId;
  }
  $("start-organisms").textContent = race ? "Start food race ↗" : physical ? "Start physical world ↗" : "Start two organisms ↗";
  $("start-organisms").disabled = controlPending || active || state.busy || !state.recording || !brainStatus?.available || (!noLlm && !observer.available);
  $("stop-organisms").hidden = (!duo && !physical) || !active;
  $("stop-organisms").disabled = controlPending;
  $("toggle-communication").disabled = controlPending || !duo || !active;
  $("toggle-communication").hidden = physical;
  $("toggle-communication").textContent = session?.communication?.enabled === false ? "Resume messages" : "Pause messages";
  $("organism-channel-status").textContent = physical ? `${race ? 'LLM FOOD RACE' : 'NO LLM'} · world step ${controlSnapshot?.world?.step ?? 0} · ${active ? "sensors → spikes → body movement" : "world stopped"}` : duo ? `${active ? "Two organisms running" : "Organisms stopped"} · channel ${session.communication.enabled ? "open" : "paused"} · ${session.messages.length} recent messages · received messages enter the partner's next prompt` : "Start two organisms to open their shared channel.";
  const messages = duo ? session.messages : [];
  const signature = JSON.stringify(messages);
  if (signature === messageSignature) return; messageSignature = signature;
  const thread = $("organism-messages"), atBottom = thread.scrollHeight-thread.scrollTop-thread.clientHeight < 60;
  const oldScroll = thread.scrollTop; thread.replaceChildren();
  if (!messages.length) thread.append(element("p", "Waiting for their first exchange…", "fine"));
  for (const message of messages) {
    const bubble = element("article", undefined, `organism-message organism-${message.sender}`);
    bubble.append(element("span", `Organism ${message.sender.toUpperCase()} → ${message.recipient.toUpperCase()}${message.delivered ? "" : " · not delivered (channel paused)"}${message.replyTo ? " · reply" : ""}`, "eyebrow"), element("p", message.text));
    const meta = element("details"); meta.append(element("summary", "Message provenance"), element("pre", JSON.stringify(message,null,2))); bubble.append(meta); thread.append(bubble);
  }
  thread.scrollTop = atBottom ? thread.scrollHeight : oldScroll;
}
function renderTrend(samples, target) {
  const canvas = $("control-trend"); canvas.hidden = !samples.length;
  if (!samples.length) return;
  const ctx = canvas.getContext("2d"), w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const hasTarget = Number.isFinite(target);
  const max = Math.max(1, hasTarget ? target : 0, ...samples.map((sample) => sample.spikes_per_second)) * 1.12;
  const y = (rate) => h - 16 - rate / max * (h - 30);
  if (hasTarget) {ctx.strokeStyle = "#d9ae7b"; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(0, y(target)); ctx.lineTo(w, y(target)); ctx.stroke(); ctx.setLineDash([]);}
  ctx.strokeStyle = "#9ed9c1"; ctx.lineWidth = 1.5; ctx.beginPath();
  samples.forEach((sample, i) => { const x = i / Math.max(1, samples.length - 1) * w; if (!i) ctx.moveTo(x, y(sample.spikes_per_second)); else ctx.lineTo(x, y(sample.spikes_per_second)); }); ctx.stroke();
  ctx.fillStyle = "#8e9c9c"; ctx.font = "10px monospace"; ctx.fillText(`Measured activity · ${(samples.at(-1).end_ms / 1000).toFixed(2)} s simulated${hasTarget ? " · dashed = target" : ""}`, 8, h - 2);
}
function renderInspector() {
  const data = state.recording, node = data?.nodes.find((node) => node.index === state.selected);
  if (!node) return;
  $("neuron-role").textContent = node.input ? "Sugar sensor" : "Downstream";
  $("neuron-intact").textContent = fmt(node.counts.sugar);
  $("neuron-disconnected").textContent = node.counts.sugar_disconnected == null ? "—" : fmt(node.counts.sugar_disconnected);
  const trialCount = node.counts[state.condition];
  $("neuron-detail").textContent = `FlyWire ID ${node.id} · ${trialCount} spikes in ${condition().label.toLowerCase()} (${(trialCount / (data.duration_ms / 1000)).toFixed(1)} Hz across this trial). Highlighted connections belong to the displayed subset.`;
}
function renderComparison() {
  if (state.recording.schema === "brain-live-v1") {
    const data = state.recording, trial = data.conditions[0];
    $("comparison-bars").replaceChildren(); $("checks").replaceChildren();
    $("propagation-result").textContent = "Live network";
    $("propagation-detail").textContent = `${fmt(trial.downstream_spikes)} downstream spikes in this ${data.duration_ms} ms window. No disconnected or baseline trial runs alongside live control.`;
    $("compute-info").textContent = `${data.engine}. One network build. Window wall time: ${trial.wall_seconds.toFixed(2)} s. Peak process memory: ${(data.peak_process_rss_mb / 1024).toFixed(2)} GiB. Neuron state and delayed signals persist.`;
    return;
  }
  const data = state.recording, { intact, disconnected, reduction } = comparison(data);
  const scale = Math.max(1, ...data.conditions.map((trial) => trial.total_spikes));
  const bars = $("comparison-bars"); bars.replaceChildren();
  for (const key of ["sugar", "sugar_disconnected", "baseline"]) {
    const trial = data.conditions.find((trial) => trial.key === key);
    const row = element("div", undefined, "comparison-row"), caption = element("div");
    caption.append(element("span", trial.label), element("strong", `${fmt(trial.total_spikes)} spikes`));
    const track = element("div", undefined, "bar-track");
    track.setAttribute("aria-label", `${trial.label}: ${trial.input_spikes} input and ${trial.downstream_spikes} downstream spikes`);
    for (const [className, count] of [["bar-input", trial.input_spikes], ["bar-downstream", trial.downstream_spikes]]) {
      const part = element("span", undefined, className); part.style.width = `${100 * count / scale}%`; track.append(part);
    }
    row.append(caption, track); bars.append(row);
  }
  $("propagation-result").textContent = reduction === null ? "No propagation" : `${(reduction * 100).toFixed(0)}% reduction`;
  $("propagation-detail").textContent = `${fmt(intact.downstream_spikes)} downstream spikes intact → ${fmt(disconnected.downstream_spikes)} disconnected, at ${data.rate_hz} Hz across ${data.duration_ms} ms. These are model responses to synthetic stimulation.`;
  const checks = $("checks"); checks.replaceChildren();
  const labels = { inactive_baseline: "Baseline silent", stimulus_fires: "Input stimulation produces spikes", connectivity_propagates: "Activity reaches downstream neurons", disconnect_blocks_propagation: "Disconnection blocks propagation", seeded_repeat_matches: "Seeded replay matches exactly" };
  for (const [key, label] of Object.entries(labels)) {
    const passed = data.checks[key] === true;
    const item = element("li", undefined, passed ? "" : "failed");
    item.append(element("span", passed ? "✓" : "○"), element("span", label + (passed ? "" : " · not observed"))); checks.append(item);
  }
  $("compute-info").textContent = `${data.engine}. Intact trial: ${intact.wall_seconds.toFixed(2)} s wall time for ${data.duration_ms} ms simulated. Peak process memory: ${(data.peak_process_rss_mb / 1024).toFixed(2)} GiB. Short-trial timing includes runtime overhead.`;
}
function loadRecording(recording, id) {
  validateRecording(recording);
  state.recording = recording; state.resultId = id; state.time = 0;
  const live = recording.schema === "brain-live-v1";
  $("circuit-title").textContent = recording.organism_id ? `Organism ${recording.organism_id.toUpperCase()} · neural activity` : "From input to response";
  if (live) state.condition = "sugar";
  $("activity-kind").textContent = live ? "STREAMED ACTIVITY" : "RECORDED SPIKES";
  for (const button of document.querySelectorAll("[data-condition]")) button.disabled = live && button.dataset.condition !== "sugar";
  $("model-neurons").textContent = fmt(recording.neurons);
  $("model-connections").textContent = `${(recording.directed_connections / 1e6).toFixed(2)} M`;
  $("recording-spec").textContent = `${recording.rate_hz} Hz · ${recording.duration_ms} ms`;
  $("recording-spec").title = `Seed ${recording.seed}; source ${recording.source_commit}`;
  $("projection-count").textContent = `${recording.nodes.length} / ${fmt(recording.neurons)} NEURONS · ${recording.edges.length} LINKS`;
  $("recording-id").textContent = `Recording ${id} · seed ${recording.seed} · source ${recording.source_commit.slice(0, 12)}`;
  $("timeline").max = String(recording.duration_ms); $("timeline").value = "0";
  const select = $("neuron-select"); select.replaceChildren();
  for (const node of recording.nodes) { const option = element("option", `${node.input ? "Sugar sensor" : "Downstream"} · ${node.id}`); option.value = String(node.index); select.append(option); }
  if (!recording.nodes.some((node) => node.index === state.selected)) state.selected = recording.nodes[0]?.index;
  select.value = String(state.selected);
  selectCondition(state.condition); renderComparison(); resize();
  showError("page-error", null);
}
function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr));
  return { width: rect.width, height: rect.height, dpr };
}
function resize() {
  circuitSize = resizeCanvas(circuit); rasterSize = resizeCanvas(raster);
  state.positions.clear();
  if (state.recording) {
    for (let layer = 0; layer < 6; layer++) {
      const nodes = state.recording.nodes.filter((node) => node.layer === layer).sort((a, b) => a.index - b.index);
      nodes.forEach((node, i) => state.positions.set(node.index, {
        x: 42 + layer * (circuitSize.width - 84) / 5 + (nodes.length > 45 ? (i % 3 - 1) * 6 : 0),
        y: 47 + (i + 0.5) * (circuitSize.height - 75) / Math.max(1, nodes.length),
      }));
    }
  }
  renderRaster();
}
function drawCircuit() {
  const { width, height, dpr } = circuitSize, ctx = circuit.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
  if (!state.recording) { ctx.fillStyle = colors.muted; ctx.font = "12px monospace"; ctx.fillText("Loading recorded neural activity…", 24, height / 2); return; }
  const data = state.recording, blocked = state.condition === "sugar_disconnected";
  const inputSet = new Set(data.nodes.filter((node) => node.input).map((node) => node.index));
  ctx.font = "8px monospace"; ctx.textAlign = "center";
  ["SENSORS", "1 STEP", "2", "3", "4", "5+ / OTHER"].forEach((label, i) => {
    ctx.fillStyle = i === 0 ? colors.copper : colors.muted;
    ctx.fillText(label, 42 + i * (width - 84) / 5, 21);
  });
  const neighbours = new Set();
  for (const edge of data.edges) if (edge.source === state.selected || edge.target === state.selected) { neighbours.add(edge.source); neighbours.add(edge.target); }
  for (const edge of data.edges) {
    const from = state.positions.get(edge.source), to = state.positions.get(edge.target);
    if (!from || !to) continue;
    const cut = blocked && inputSet.has(edge.source);
    const selected = edge.source === state.selected || edge.target === state.selected;
    const spike = recentSpike(state.spikeTimes.get(edge.source), state.time);
    ctx.globalAlpha = cut ? .07 : selected ? .45 + spike * .35 : .045 + spike * .22;
    ctx.strokeStyle = cut ? "#b7867d" : edge.weight < 0 ? colors.purple : colors.mint;
    ctx.lineWidth = selected ? 1 : .6;
    ctx.setLineDash(cut ? [2, 4] : []);
    ctx.beginPath(); ctx.moveTo(from.x, from.y);
    ctx.bezierCurveTo(from.x + (to.x - from.x) * .45, from.y, to.x - (to.x - from.x) * .45, to.y, to.x, to.y); ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const node of data.nodes) {
    const position = state.positions.get(node.index); if (!position) continue;
    const spike = recentSpike(state.spikeTimes.get(node.index), state.time);
    const selected = node.index === state.selected;
    ctx.fillStyle = node.input ? colors.copper : colors.mint;
    if (spike > 0) { ctx.globalAlpha = spike * .12; ctx.beginPath(); ctx.arc(position.x, position.y, 8 + spike * 4, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = selected ? 1 : .28 + spike * .72;
    ctx.beginPath(); ctx.arc(position.x, position.y, node.input ? 3 : 2 + spike, 0, Math.PI * 2); ctx.fill();
    if (selected || neighbours.has(node.index)) { ctx.globalAlpha = selected ? 1 : .25; ctx.strokeStyle = selected ? "#ffffff" : colors.mint; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(position.x, position.y, selected ? 7 : 4.5, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.globalAlpha = 1; ctx.textAlign = "start";
}
function rasterBounds() { return { left: 42, top: 15, width: Math.max(1, rasterSize.width - 62), height: Math.max(1, rasterSize.height - 49) }; }
function renderRaster() {
  if (!state.recording) return;
  rasterImage.width = raster.width; rasterImage.height = raster.height;
  const ctx = rasterImage.getContext("2d"), { dpr } = rasterSize, area = rasterBounds();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rasterSize.width, rasterSize.height);
  const data = state.recording, rows = new Map(data.nodes.map((node, i) => [node.index, i]));
  const inputs = new Set(data.nodes.filter((node) => node.input).map((node) => node.index));
  const rowY = (index) => area.top + (rows.get(index) + .5) / data.nodes.length * area.height;
  ctx.font = "8px monospace"; ctx.fillStyle = colors.muted; ctx.strokeStyle = "#23302e";
  for (let i = 0; i <= 4; i++) { const x = area.left + area.width * i / 4; ctx.beginPath(); ctx.moveTo(x, area.top); ctx.lineTo(x, area.top + area.height); ctx.stroke(); ctx.textAlign = "center"; ctx.fillText(`${data.duration_ms * i / 4}`, x, area.top + area.height + 16); }
  ctx.textAlign = "left"; ctx.fillText("ms", area.left + area.width - 5, area.top + area.height + 30);
  ctx.save(); ctx.translate(13, area.top + area.height / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillText("DISPLAYED NEURONS", 0, 0); ctx.restore();
  if (rows.has(state.selected)) { ctx.fillStyle = "#9ed9c118"; ctx.fillRect(area.left, rowY(state.selected) - 3, area.width, 6); }
  for (const [time, index] of condition().events) {
    const selected = index === state.selected;
    ctx.fillStyle = selected ? "#ffffff" : inputs.has(index) ? colors.copper : colors.mint;
    ctx.globalAlpha = selected ? 1 : .65;
    ctx.fillRect(area.left + time / data.duration_ms * area.width, rowY(index) - (selected ? 2 : .7), selected ? 1.7 : 1, selected ? 4 : 1.4);
  }
  ctx.globalAlpha = 1;
}
function drawRasterCursor() {
  const ctx = raster.getContext("2d"), { dpr } = rasterSize, area = rasterBounds();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, raster.width, raster.height); ctx.drawImage(rasterImage, 0, 0);
  if (!state.recording) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); const x = area.left + state.time / state.recording.duration_ms * area.width;
  ctx.strokeStyle = "#edf3ef"; ctx.lineWidth = 1; ctx.globalAlpha = .7; ctx.beginPath(); ctx.moveTo(x, area.top); ctx.lineTo(x, area.top + area.height); ctx.stroke(); ctx.globalAlpha = 1;
}
function applyStatus(status) {
  brainStatus = status;
  state.busy = status.state === "running";
  $("run-status").textContent = status.available ? status.progress : "Model unavailable · see brain/README.md for setup";
  $("status-indicator").className = state.busy ? "running" : "";
  $("run-experiment").disabled = state.busy || !status.available;
  $("cancel-experiment").hidden = !state.busy;
  showError("run-error", status.error);
  renderControl();
}
async function refresh() {
  if (state.polling) return;
  state.polling = true;
  try {
    const [status, control] = await Promise.all([api("status"), api("control/status")]);
    controlSnapshot = control; applyStatus(status);
    const viewLive = selectedLive(control), selectedId = state.organism;
    const useLive = viewLive?.latestId && ["continuous", "duo", "physical", "race"].includes(control.session?.settings.mode) &&
      (control.active || status.resultId === control.session.settings.resultId);
    if (useLive && state.resultId !== viewLive.latestId) {
      const live = await api(control.organisms?.length ? `control/live?organism=${selectedId}` : "control/live");
      if (selectedId === state.organism) loadRecording(live.recording, live.resultId);
    } else if (!useLive && status.resultId && status.resultId !== state.resultId) {
      const result = await api("result"); loadRecording(result.recording, result.resultId);
    }
  } catch (error) {
    brainStatus = null; renderControl();
    $("run-status").textContent = "Local server unavailable · start with npm start";
    $("run-experiment").disabled = true;
    showError("run-error", error.message);
    if (!state.recording) {
      try { const response = await fetch("data/brain-lab-reference.json"); if (!response.ok) throw new Error("No reference recording"); loadRecording(await response.json(), "reference-200ms"); }
      catch { showError("page-error", "Could not load the reference recording. Start the local server with npm start and reload this page."); }
    }
  } finally { state.polling = false; }
}
$("stimulation").addEventListener("input", () => { $("stimulation-value").textContent = `${$("stimulation").value} Hz`; });
$("control-mode").addEventListener("change", renderControl);
$("start-organisms").addEventListener("click", () => { if (!["physical","race"].includes($("control-mode").value)) $("control-mode").value = "duo"; $("control-form").requestSubmit(); });
$("stop-organisms").addEventListener("click", () => $("stop-control").click());
$("toggle-communication").addEventListener("click", async () => {
  controlPending = true; controlRequestError = null; renderControl();
  try { controlSnapshot = await api("control/communication", { enabled: !controlSnapshot.session.communication.enabled }); }
  catch (error) { controlRequestError = error.message; }
  finally { controlPending = false; renderControl(); }
});
$("control-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (controlPending || controlSnapshot?.active || !state.recording) return;
  controlPending = true; controlRequestError = null; renderControl();
  try {
    controlSnapshot = await api("control/start", { resultId: brainStatus.resultId, mode: $("control-mode").value,
      interval_ms: Number($("control-interval").value),
      target_spikes_per_second: Number($("control-target").value), rounds: Number($("control-rounds").value),
      duration_ms: Number($("control-duration").value), seed: Number($("control-seed").value),
      ...($("control-mode").value === "race" ? { game_seconds: Number($("race-duration").value), plan_seconds: Number($("race-horizon").value), swap_sides: $("race-swap").checked } : {}) });
  } catch (error) { controlRequestError = error.message; }
  finally { controlPending = false; renderControl(); }
});
$("stop-control").addEventListener("click", async () => {
  if (controlPending) return;
  controlPending = true; controlRequestError = null; renderControl();
  try { controlSnapshot = await api("control/stop", {}); }
  catch (error) { controlRequestError = error.message; }
  finally { controlPending = false; await refresh(); renderControl(); }
});
$("export-control-log").addEventListener("click", () => {
  const link = document.createElement("a"), url = URL.createObjectURL(new Blob([
    JSON.stringify({ schema: "brain-control-v1", sessions: controlSnapshot?.sessions ?? [] }, null, 2),
  ], { type: "application/json" }));
  link.href = url; link.download = "brain-control-log.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("explain-condition").addEventListener("click", () => observer.explain());
$("observer-auto").addEventListener("change", (event) => observer.enable(event.target.checked));
$("cancel-observation").addEventListener("click", () => observer.cancel());
$("export-observer-log").addEventListener("click", () => {
  const link = document.createElement("a"), url = URL.createObjectURL(new Blob([
    JSON.stringify({ schema: "brain-observer-log-v1", entries: observer.entries }, null, 2),
  ], { type: "application/json" }));
  link.href = url; link.download = "brain-observer-log.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("experiment-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (state.busy) return;
  $("run-experiment").disabled = true; showError("run-error", null);
  try { applyStatus(await api("run", { rate_hz: Number($("stimulation").value), duration_ms: Number($("duration").value), seed: Number($("seed").value) })); }
  catch (error) { showError("run-error", error.message); $("run-experiment").disabled = false; }
});
$("cancel-experiment").addEventListener("click", async () => { $("cancel-experiment").disabled = true; try { applyStatus(await api("cancel", {})); } catch (error) { showError("run-error", error.message); } finally { $("cancel-experiment").disabled = false; } });
for (const button of document.querySelectorAll("[data-condition]")) button.addEventListener("click", () => selectCondition(button.dataset.condition));
$("neuron-select").addEventListener("change", (event) => selectNeuron(Number(event.target.value)));
$("play").addEventListener("click", () => setPlaying(!state.playing));
$("rewind").addEventListener("click", () => { state.time = 0; });
$("timeline").addEventListener("input", (event) => { state.time = Number(event.target.value); setPlaying(false); });
circuit.addEventListener("click", (event) => {
  const rect = circuit.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
  let nearest = null, distance = 14;
  for (const [index, p] of state.positions) { const d = Math.hypot(x - p.x, y - p.y); if (d < distance) { nearest = index; distance = d; } }
  if (nearest !== null) selectNeuron(nearest);
});
raster.addEventListener("click", (event) => {
  if (!state.recording) return;
  const rect = raster.getBoundingClientRect(), area = rasterBounds();
  state.time = Math.max(0, Math.min(state.recording.duration_ms, (event.clientX - rect.left - area.left) / area.width * state.recording.duration_ms)); setPlaying(false);
  const row = Math.max(0, Math.min(state.recording.nodes.length - 1, Math.floor((event.clientY - rect.top - area.top) / area.height * state.recording.nodes.length)));
  selectNeuron(state.recording.nodes[row].index);
});
$("export-recording").addEventListener("click", () => {
  if (!state.recording) return;
  const link = document.createElement("a"), url = URL.createObjectURL(new Blob([JSON.stringify(state.recording, null, 2)], { type: "application/json" }));
  link.href = url; link.download = `brain-${state.resultId}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
new ResizeObserver(resize).observe($("circuit").parentElement);
window.addEventListener("resize", resize);
let lastTime = performance.now(), lastLabel = 0;
function frame(now) {
  const elapsed = Math.min(100, now - lastTime); lastTime = now;
  if (state.playing && state.recording) state.time = state.recording.schema === "brain-live-v1" ?
    Math.min(state.recording.duration_ms, state.time + elapsed * state.recording.duration_ms / Math.max(1, state.recording.conditions[0].wall_seconds * 1000)) :
    (state.time + elapsed / Number($("playback-speed").value)) % state.recording.duration_ms;
  drawCircuit(); drawRasterCursor();
  bodyView.draw(now, state.organism);
  if (state.recording && now - lastLabel > 60) {
    $("timeline").value = String(state.time); const offset = state.recording.start_ms ?? 0;
    $("playback-time").textContent = `${(offset + state.time).toFixed(1)} / ${(offset + state.recording.duration_ms).toFixed(0)} ms`; lastLabel = now;
  }
  requestAnimationFrame(frame);
}
function checkObserver() { if ($("control-mode").value !== "physical") observer.check(); }
resize(); refresh(); checkObserver(); setInterval(refresh, 1200); setInterval(checkObserver, 10000); requestAnimationFrame(frame);
