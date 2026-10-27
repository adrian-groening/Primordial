"""One persistent FlyWire network; JSON windows out, input-rate commands in."""
import argparse
import hashlib
import importlib.util
import json
import queue
import resource
import sys
import threading
from pathlib import Path
from time import perf_counter

import brian2 as b2
import numpy as np
import pandas as pd
from fetch_reference import verified
from run_reference import ROOT, sugar_ids


def fingerprint(neurons, time_ms):
    digest = hashlib.sha256()
    digest.update(np.asarray(neurons.v[:]).tobytes())
    digest.update(np.asarray(neurons.g[:]).tobytes())
    digest.update(np.float64(time_ms).tobytes())
    return digest.hexdigest()


def run(window_ms, rate_hz, seed, output, external_step=False, engine="numpy"):
    manifest = json.loads((ROOT / "reference-manifest.json").read_text())
    reference = ROOT / "reference"
    for entry in manifest["files"]:
        if not verified(reference / entry["name"], entry):
            raise RuntimeError(f"Changed reference file: {entry['name']}")
    template = json.loads((ROOT.parent / "dist/data/brain-lab-reference.json").read_text())
    if template["source_commit"] != manifest["commit"]:
        raise RuntimeError("Circuit projection and model source differ")
    output.mkdir(parents=True, exist_ok=False)
    spec = importlib.util.spec_from_file_location("flywire_live", reference / "model.py")
    model = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(model)
    b2.start_scope()
    b2.prefs.codegen.target = engine
    b2.defaultclock.dt = .1 * b2.ms
    b2.seed(seed)  # Seed once. Neither neural state nor RNG is restored between windows.
    params = dict(model.default_params)
    params["eq_rst"] = "v = v_rst; g = 0 * mV"
    params["r_poi"] = rate_hz * b2.Hz
    table = pd.read_csv(reference / "2023_03_23_completeness_630_final.csv", index_col=0)
    lookup = {int(fly_id): i for i, fly_id in enumerate(table.index)}
    excited = [lookup[i] for i in sugar_ids(reference / "example.ipynb")]
    neu, syn, monitor = model.create_model(reference / "2023_03_23_completeness_630_final.csv",
                                           reference / "2023_03_23_connectivity_630_final.parquet", params)
    if external_step:
        # Mutable rates avoid rebuilding/recompiling 21 PoissonInput objects for
        # every sensor update. N=1 Bernoulli events at dt match the input model's
        # per-timestep semantics; this adapter has its own seeded RNG sequence.
        stimulus = b2.PoissonGroup(len(excited), rates=rate_hz * b2.Hz, name="virtual_sensors")
        stimulus_syn = b2.Synapses(stimulus, neu, on_pre="v_post += virtual_weight", namespace={"virtual_weight": params["w_syn"] * params["f_poi"]}, name="virtual_sensor_synapses")
        stimulus_syn.connect(i=np.arange(len(excited)), j=excited)
        neu.rfc[excited] = 0 * b2.ms
        inputs = [stimulus, stimulus_syn]
    else:
        inputs, neu = model.poi(neu, excited, [], params)
    net = b2.Network(neu, syn, monitor, *inputs)
    selected = [node["index"] for node in template["nodes"]]
    # Synthetic readout pools, balanced by the bundled reference response.
    # These are not annotated biological left/right motor neurons.
    pools, weights = [[], []], [0, 0]
    for node in sorted((n for n in template["nodes"] if not n["input"]), key=lambda n: -n["counts"]["sugar"])[:128]:
        bank = 0 if weights[0] <= weights[1] else 1
        pools[bank].append(node["index"])
        weights[bank] += node["counts"]["sugar"]
    sensory = None
    commands = queue.SimpleQueue()

    def read_commands():
        for line in sys.stdin:
            try:
                value = json.loads(line)
                rate = value.get("rate_hz")
                if type(rate) is not int or not (0 if external_step else 25) <= rate <= 250:
                    raise ValueError("Invalid input rate")
                if external_step:
                    rates = value.get("sensory_rates", {})
                    if set(rates) != {"left_hz", "right_hz", "contact_hz"} or any(type(v) is not int or not 0 <= v <= 250 for v in rates.values()):
                        raise ValueError("Invalid embodied sensory rates")
                commands.put(value)
            except Exception as error:
                print(str(error), file=sys.stderr, flush=True)
        commands.put({"stop": True})

    threading.Thread(target=read_commands, daemon=True).start()
    print(json.dumps({"type": "ready", "network_builds": 1}), flush=True)
    sequence, decision_id = 0, None
    while True:
        command = commands.get() if external_step else None
        if command and command.get("stop"):
            return
        while not commands.empty():
            command = commands.get()
            if command.get("stop"):
                return
        if command:
            decision_id = command.get("decision_id")
            if external_step and command["sensory_rates"] != sensory:
                sensory = command["sensory_rates"]
                stimulus.rates = ([sensory["left_hz"]] * 10 + [sensory["right_hz"]] * 10 + [sensory["contact_hz"]]) * b2.Hz
            elif not external_step and command["rate_hz"] != rate_hz:
                # PoissonInput.rate is immutable. Replace only the external inputs;
                # retain neurons, synapses, pending synaptic delays, clock and RNG.
                net.remove(*inputs)
                rate_hz = command["rate_hz"]
                params["r_poi"] = rate_hz * b2.Hz
                inputs, neu = model.poi(neu, excited, [], params)
                net.add(*inputs)
            rate_hz = command["rate_hz"]
        start_ms = float(net.t / b2.ms)
        before = fingerprint(neu, start_ms)
        started = perf_counter()
        net.run(window_ms * b2.ms, namespace={})
        wall = perf_counter() - started
        end_ms = float(net.t / b2.ms)
        after = fingerprint(neu, end_ms)
        indices = np.asarray(monitor.i[:], dtype=np.int32)
        times = np.asarray(monitor.t[:] / b2.ms) - start_ms
        counts = np.asarray(monitor.count[:], dtype=np.int64)
        downstream = int((~np.isin(indices, excited)).sum())
        visible = np.flatnonzero(np.isin(indices, selected))
        shown = visible if len(visible) <= 100000 else visible[np.linspace(0, len(visible)-1, 100000, dtype=int)]
        sequence += 1
        payload = {key: template[key] for key in ["dataset", "paper", "source_commit", "neurons", "directed_connections", "dt_ms", "edges"]}
        payload.update({"schema": "brain-live-v1", "sequence": sequence, "recorded_at": output.name,
            "duration_ms": window_ms, "start_ms": start_ms, "end_ms": end_ms,
            "rate_hz": rate_hz, "seed": seed, "decision_id": decision_id, "network_builds": 1,
            "state_before": before, "state_after": after,
            "engine": f"Brian2 {b2.__version__}, persistent {engine} CPU network",
            "peak_process_rss_mb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024**2 if sys.platform == "darwin" else 1024),
            "checks": {}, "projection": "Fixed reference circuit subset; whole-network counters cover all neurons.",
            "nodes": [{**node, "counts": {"sugar": int(counts[node["index"]])}} for node in template["nodes"]],
            "conditions": [{"key": "sugar", "label": "Live intact", "total_spikes": int(len(indices)),
                "input_spikes": int(len(indices)) - downstream, "downstream_spikes": downstream,
                "active_neurons": int(np.count_nonzero(counts)), "wall_seconds": wall,
                "selected_spike_count": int(len(visible)), "events_sampled": len(shown) < len(visible),
                "events": [[round(float(times[i]), 4), int(indices[i])] for i in shown]}]})
        if external_step:
            payload["external_step"] = True
            payload["sensory_rates"] = sensory
            payload["motor_output"] = {"left_hz": float(counts[pools[0]].sum()) / len(pools[0]) / (window_ms / 1000),
                "right_hz": float(counts[pools[1]].sum()) / len(pools[1]) / (window_ms / 1000),
                "left_spikes": int(counts[pools[0]].sum()), "right_spikes": int(counts[pools[1]].sum()),
                "left_indices": pools[0], "right_indices": pools[1],
                "mapping": "Synthetic reference-activity-balanced readout pools, not anatomical motor annotations"}
        text = json.dumps(payload, separators=(",", ":"))
        temporary = output / "latest.partial"
        temporary.write_text(text)
        temporary.replace(output / "latest.json")
        print('{"type":"window","recording":' + text + '}', flush=True)
        # Clear only the recorder buffers/counters. The monitor's compiled code,
        # neural state, delay queues and RNG remain intact. resize does not set N.
        monitor.resize(0)
        monitor.variables["N"].set_value(0)
        monitor.variables["count"].get_value()[:] = 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--window-ms", type=int, required=True)
    parser.add_argument("--rate-hz", type=int, required=True)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--external-step", action="store_true")
    parser.add_argument("--engine", choices=["numpy", "cython"], default="numpy")
    args = parser.parse_args()
    if not 100 <= args.window_ms <= 1000 or not 25 <= args.rate_hz <= 250 or not 0 <= args.seed < 2**32:
        parser.error("Invalid live settings")
    run(args.window_ms, args.rate_hz, args.seed, args.output, args.external_step, args.engine)
