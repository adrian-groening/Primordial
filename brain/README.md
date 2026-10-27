# Fly brain model: local reference experiment

This folder runs the published Shiu et al. (2024) leaky integrate-and-fire model using the authors' FlyWire v630 connectivity and sugar-sensing neuron IDs. It is separate from the evolution simulator's small artificial neural networks.

**Dataset distinction:** this is the FlyWire reference used by the computational modelling paper, not the male whole-CNS connectome in `2025.10.09.680999v2.full.pdf`. We have not downloaded or simulated that male CNS dataset. The reference is a first executable baseline for testing this computer and the simulation workflow.

Sources:

- Model paper: https://doi.org/10.1038/s41586-024-07763-9
- Authors' code and data: https://github.com/philshiu/Drosophila_brain_model
- Male CNS data for a later adaptation: https://male-cns.janelia.org/download/

## Brain Lab interface

Run `npm start` at the project root and open `http://127.0.0.1:4173/brain-lab.html`, or follow **Fly Brain Lab** from either ecosystem page. The bundled reference recording is generated from the first verified run, not invented demonstration data.

The interface provides:

- Recorded spike playback, pause, rewind, time scrubbing and adjustable visual slowdown.
- Intact, disconnected, no-stimulus and seeded-repeat conditions using the same displayed neurons.
- A circuit view of up to 256 input/active neurons and the 600 strongest connections within that subset. Positions show capped graph distance within the subset, not anatomical locations. The underlying experiment still simulates the full reference graph.
- A raster of recorded spikes in that subset, selection by node/menu/raster, exact per-neuron counts, and full-model comparison counts. Extremely dense traces are sampled at 100,000 marks per condition with a visible notice; full-model counts are never sampled.
- Stimulation from 25–250 Hz, trial duration from 100–1,000 ms and a uint32 random seed. Changing controls configures the next experiment; the recording header always shows the settings actually used.
- A download of the displayed recording and its provenance as JSON.

**Run experiment** starts one local Python process and executes all four conditions. Playback does not advance or change the simulation. The server accepts one brain job at a time, keeps the previous recording on failure/cancellation and terminates a job after three minutes. Brain Lab runs independently of the ecological engine. The server closes the brain process on shutdown. On Apple Silicon the launcher explicitly uses ARM Python, including when Node runs under Rosetta.

Completed runs live in `brain/results/lab-<timestamp>-<id>/` with complete NPZ spike recordings, `summary.json` and bounded `playback.json`. On server restart the most recent complete lab recording is restored. Interrupted directories may remain for diagnosis. There is no automatic deletion of run history.

At lower input rates or shorter durations, downstream propagation might not occur. Brain Lab preserves those outcomes and reports the observed checks; it does not require a positive response. The original command-line reference check still requires all five checks by default. The paired recording mode remains independent of the ecosystem; the physical-world mode below adds an experimental virtual body.

## Local language observer

Brain Lab's **Put the response into words** panel connects to Ollama at `127.0.0.1:11434`, using the installed `llama2-uncensored:latest` model. Start Ollama (`ollama serve`) alongside `npm start`, then select **Explain this condition**. The page works in VS Code's integrated browser. **Observe condition changes** optionally requests commentary when switching conditions or loading a new recording; it starts unchecked. Selecting another neuron requires a manual explanation. Playback frames do not trigger generation.

The observer receives server-owned completed-trial settings, full-model spike totals, paired intact/disconnected results, validation checks and the selected neuron's recorded counts. It does not receive pending controls or pretend to read the playback instant. The paired recordings supplied to this observer have no body or energy state. Physical-world mode has its own measured body state and disables language inference. The observer has no access to experiment controls, weights, actions or reproduction. Its text is generated commentary; the recorded counters remain the evidence.

Expand **Observation log** entries to inspect the exact facts, model request and raw reply, with recording/condition/neuron identity and a SHA-256 context digest. Replies remain attached to their original selection even if you change conditions while the model is running. **Download log** exports the latest 40 entries; the panel shows the latest eight. The append-only local audit file is `brain/results/observer-log.ndjson`, and recent entries are restored after a server restart. Failed and cancelled requests are logged too. Only one observer request runs at a time, with cancellation and a 90-second timeout. Inference stays on the local Ollama endpoint.

## LLM input control

In **Let the model drive the input**, select **One organism · continuous** for the single-brain mode. Set a target downstream population spike rate, activity-window duration, seed and minimum time between decisions, then select **Start LLM control**. `continuous_runner.py` builds the full network once and advances it in 100–1,000 ms simulated windows without restoring membrane state, conductances, synaptic delays, clock or random state. It seeds once at startup. In this free-running mode Brian2's immutable Poisson inputs are replaced only when the input rate changes; neurons and synapses remain the same. Spike-monitor buffers and counters are cleared after every exported window, retaining the monitor and compiled code without accumulating spike history. Starting a new session initializes a new network; this does not resume a previous neural checkpoint.

The brain keeps running at its last input while local Llama 2 generates a validated integer rate from 25–250 Hz. Commands apply at window boundaries, and their decision IDs are acknowledged in the resulting window. The next decision uses fresh measured activity and recent outcomes. A server-calculated above/below-target comparison and qualitative guidance help interpret the target. Within 10% of the target, guidance asks the LLM to maintain activity; continuous control keeps running. The minimum decision interval is measured in wall time, and slow inference can make updates farther apart. Invalid/unavailable/timed-out LLM replies are logged as rejected; the existing input remains applied and another decision is requested after the interval. No replacement rate is invented. Structured JSON output constrains the model, with strict server validation retained. Stop aborts inference and terminates the owned persistent process. A neural-runner error or 180-second stall stops the session.

The target is total downstream spikes divided by window seconds, summed over the entire network, **not** a per-neuron firing rate. The circuit and raster stream actual measured windows using a fixed reference projection (up to 256 neurons/600 links); neurons outside that subset still contribute to full-model counters. The timeline shows absolute simulated time. A trend shows the latest 120 windows against the target. Window playback is paced using measured compute time and holds at its end until another window arrives, instead of looping one recording indefinitely. This CPU runs the full model slower than biological real time. The live view does not invent simultaneous baseline/disconnected trials. The separate observer remains available for paired recordings; live decision rationales appear in the control log.

Select **Paired experiments · bounded** to retain the earlier 1–5-round experiment: baseline, intact, disconnected and seeded repeat each reset to the same initial state. That mode stops within 10% of target or at its round limit. Neither mode trains the connectome, changes its weights permanently, gives the spiking neurons language, or attaches a body. Model rationales may misstate facts; the counters remain the evidence.

**Decisions & measured outcomes** and its download include exact requests/raw replies, applied rates, recording IDs and measured errors. Continuous sessions retain their latest 20 decisions and 120 activity samples in memory; the controller audit snapshot retains the latest ten sessions in `brain/results/controller-state.json`. Each live session overwrites only its own `brain/results/live-<session-id>/latest.json` snapshot instead of writing every window to a growing recording archive. Completed paired recordings are retained separately. `/api/brain/control/live` returns the latest actual window; `/control/status` reports the running session and bounded trend. Consecutive window fingerprints of membrane/conductance state and time, sequence numbers and clock continuity are checked before display. Manual runs wait until control ends. Reloading reconnects to the same running network. Server restarts leave control interrupted and do not restore live membrane state or auto-resume it. Each LLM decision retains its 90-second timeout.

## Two organisms and communication

Select **Two organisms · communicating** for the earlier language experiment. **Start two organisms** starts Organism A and B as independent persistent Python processes. Both use the same reference connectivity and parameters; A uses the configured seed and B uses `(seed + 1) mod 2^32`. Their neural arrays, input rates, random generators, state fingerprints, clocks and recording namespaces are separate. In this language mode physical bodies, movement, DNA evolution and a shared ecological world are not attached. Card colors identify the two agents, not genetic differences. This mode consumes roughly twice the neural compute/memory of the single-brain mode and remains slower than real time.

One local Llama 2 model takes alternating turns as the two controllers. Each prompt contains only that agent's measured brain activity, its own input history, its target and its delivered inbox (up to four recent messages), plus up to two messages it previously sent. The peer's private neural readout is not inserted into the prompt. Messages are unverified reports from the other controller. Each validated reply includes `rate_hz`, `rationale` and a short `message`; it can affect only the speaker's own stimulation. The receiver can use the message in its next input decision. Speech comes from the LLM layer, not a learned language circuit in FlyWire.

The conversation records sender, recipient, delivery status, wall timestamp, source neural-window ID, decision ID and the exact inbox message being replied to. The control audit stores the full model request, raw reply and IDs of messages supplied to each turn. **Pause messages** closes the channel while both brains and their input controllers continue running; muted messages do not enter an inbox. An already-running inference can still reflect an earlier received message, but any message it emits while paused is marked not delivered. **Resume messages** reopens delivery. This supports a qualitative comparison; it is not a controlled causal study by itself.

Use **Inspect this brain** on either card to switch the shared circuit/raster and activity trend. Each card keeps its own clock/readout visible. The agents run asynchronously and do not share a synchronized physical world. Recent history is bounded to 40 conversation entries, 40 decisions across both agents, and 120 activity samples per brain. The control-log download includes the conversation. Live snapshots use `brain/results/live-<session-id>-a/latest.json` and `...-b/latest.json`. `/api/brain/control/live?organism=a` or `b` selects a window; POST `/api/brain/control/communication` with `{ "enabled": false }` or `true` changes delivery. **Stop both** aborts pending inference and terminates both owned processes. Startup failure of either brain stops the other. Reloading reconnects to the same session; a server restart retains recent conversation in the audit log but never resumes the brains automatically.

## Physical world without an LLM

**Physical world · no LLM** is the default. It connects two persistent, intact FlyWire networks to a shared 240 × 150 mm virtual arena. The black coordinate grid contains solid walls/circular obstacles and edible food patches. Articulated insect-like bodies have a 4.5 mm collision envelope, inertia, local body reflexes, energy expenditure and contact feeding. Food regrows after 12 simulated seconds. The two bodies start with identical parameters and wiring; their neural seeds are independent as above. This is a separate two-body experiment, not a replacement for the existing evolutionary ecosystem or a reproduction/genetics model.

The coupling is explicitly experimental: a food concentration gradient sampled at two virtual antenna locations drives two banks of ten reference sugar inputs. One remaining sugar input carries a virtual contact proxy. Environmental external rates range from 0–250 Hz; living agents receive a 30 Hz chemical background and a 20 Hz contact-channel background. This is external stimulation, not a change to the reference model's zero basal firing assumption. Left/right channels are arbitrary interface partitions, not anatomical sensory annotations. Occluded food does not contribute to the chemical sensor. Dead bodies receive zero input.

The 128 most active downstream neurons from the bundled reference recording are assigned to two pools balanced by reference spike totals. Measured mean spikes/second per pool supply normalized motor drive (`hz / (hz + 20)`), maximum 45 mm/s, with differential yaw and a 0.12 s velocity response. Explicit synthetic body reflexes modulate throttle and turning using local chemical gradients, energy deficit, fatigue, nearby bodies and contact. They include correlated seeded exploration, short antenna-scanning pauses, food handling, recovery intervals and contact escape. They are not behaviours learned by the connectome. Each body starts at 82% energy. The current neural drive/turn and reflex turn/throttle are exported separately in the body control record. Pool indices and exact counts/rates are exported in each neural window. These are synthetic motor readouts, not identified fly descending motor neurons. This does not validate biological walking, food seeking or sensory interpretation. Zero motor activity cannot propel a resting body: exploration and food-gradient reflexes are gated by measured neural drive. Local surface sensing turns away before impact; contact normals are combined into an inward escape direction, so two walls cannot impose contradictory tangent headings in a corner. Bodies expend energy through elapsed time and travelled distance; contacting edible food restores energy, and depleted energy disables motor force.

The physical mode defaults to compiled Brian2 Cython execution (`BRAIN_BODY_ENGINE=numpy npm start` selects the slower NumPy fallback). Cython and a C/C++ toolchain are required; initial compilation can take tens of seconds and is cached. Both engines use the full reference graph. A mutable 21-cell PoissonGroup delivers external voltage kicks through zero-delay synapses at the original synaptic scheduling stage. This preserves the per-timestep N=1 Bernoulli input semantics while using a new reproducible random sequence; it is not bitwise identical to the earlier 21-PoissonInput adapter. Rates change without rebuilding/compiling input objects. Monitor buffers/counters are cleared without replacing the monitor, neural state or delayed-event queues.

The Python runner uses `--external-step` in this mode: it builds once, waits for a sensory command, advances exactly one neural window, emits measured readouts and waits again. The server samples both bodies at the same world time, sends their sensory inputs, waits for **both** neural windows, validates clocks/input identities/readout counts and advances the arena by that same simulated duration. Neurons, conductances, delayed synaptic events, clock and RNG persist. There is no LLM call in this control path. While it is active, language-inference endpoints are disabled. The local Ollama model/server can remain fully stopped.

The recommended neural window is 200 ms, balancing input cadence against full-network overhead. The viewer includes an enlarged selected-organism view, alternating tripod gait, articulated antennae/head sampling, feeding motions and explicit behaviour labels. These show body-adapter state, not claims about emotion or biological consciousness. The viewer smoothly plays back the completed physical substeps; it never advances physics or predicts unsimulated motion. Full-model CPU compute remains slower than real time. Click either body or its **Inspect this brain** button to inspect its spikes. Cards show measured activity, energy, meals, contacts, travelled distance and motor rates. The physical log exports sensor values, motor values and neural-window provenance for the latest 40 physical steps. Trails retain 240 positions per body, contacts retain 60 events and neural graphs retain 120 samples per brain. The latest world snapshot is saved in the controller audit alongside the usual per-agent neural-window files. Stop terminates both processes and retains the latest results. A new session initializes new brains and bodies; it is not a membrane-state checkpoint restore.

## Install and download

Run these commands from the project root with Python 3.12 and curl available:

```sh
python3 -m venv brain/.venv
brain/.venv/bin/python -m pip install -r brain/requirements-lock.txt
python3 brain/fetch_reference.py
```

The downloader fetches about 90 MB to `brain/reference/` from the exact commit in `reference-manifest.json`. It verifies each file's size and Git blob hash, including the authors' source code, example notebook and MIT license. It reuses verified files. The environment, downloaded reference and run outputs are excluded from the outer project's Git history; the downloader and manifest reproduce them.

`requirements.txt` declares bounded direct dependencies. `requirements-lock.txt` records the versions used for the first local run; wheels and compatibility on other operating systems may differ.

## Run

```sh
brain/.venv/bin/python brain/run_reference.py --duration-ms 200
```

The runner uses the authors' full reference graph and neuron dynamics with a 0.1 ms timestep. It runs one short trial per condition, sequentially on the CPU using Brian2's NumPy target:

1. No external stimulation.
2. Poisson stimulation of the 21 sugar-sensing neurons identified in the authors' notebook.
3. The same stimulus, with outgoing weights of those 21 neurons set to zero.
4. A repeat of condition 2 from the same initial state and random seed.

Checks require a silent baseline, a response to stimulation, downstream propagation, blocked downstream propagation after disconnection, and an exact match of spike IDs/times in the seeded repeat. Under the reference model's zero basal firing assumption, the silent baseline is expected.

Results go to a new timestamped directory in `brain/results/`. `summary.json` contains the dataset identity, source commit, parameters, timing, process peak memory, checks and most active neuron IDs. Each condition has an NPZ file with neuron indices and spike times in milliseconds. Map indices to FlyWire IDs using the unchanged row order of the reference neuron CSV. `--duration-ms`, `--rate-hz`, `--seed` and `--output` allow controlled reruns; an existing output directory is never overwritten.

## Compatibility and interpretation

The original source is retained unchanged and verified before import. The runner overrides only the reset expression: the upstream string assigns `w = 0` even though `w` is not a declared neuron variable. Removing that unused assignment allows modern Brian2 to run while retaining the voltage and conductance resets. Synaptic weights are still assigned by the upstream `create_model` function.

This is a short software and connectivity check, not a reproduction of the paper's full experimental validation. It does not establish accurate behaviour, consciousness, learning, flight or real-time performance. The separate physical-world experiment now supplies explicit synthetic sensory/motor adapters and virtual bodies; their biological validity has not been established. The reference brain is not deployed into the 3D planet. The current reference omits biological mechanisms discussed in the paper, including morphology and neuromodulation.

Next steps are to measure longer runs, inspect the relevant circuit's activity, and choose an explicit sensory/motor interface before adding an embodied agent. Adapting to MaleCNS requires separate data loading, annotation mapping and validation; FlyWire IDs must not be reused as MaleCNS IDs.
