"""Run a paired input/connection check using the authors' FlyWire v630 model."""

import argparse
import ast
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import resource
import sys
from time import perf_counter

import brian2 as b2
import numpy as np
import pandas as pd

from fetch_reference import verified

ROOT = Path(__file__).resolve().parent


def sugar_ids(notebook):
    """Read the authors' explicit ID list without executing notebook cells."""
    for cell in json.loads(notebook.read_text())["cells"]:
        if cell["cell_type"] != "code":
            continue
        source = "".join(cell["source"])
        if source.startswith("neu_sugar ="):
            return ast.literal_eval(ast.parse(source).body[0].value)
    raise ValueError("No sugar neuron IDs in the reference notebook")


def run(duration_ms=200.0, seed=90210, rate_hz=150.0, output=None, *, require_checks=True):
    if not np.isfinite(duration_ms) or not 0 < duration_ms <= 5000:
        raise ValueError("duration must be finite, > 0 and <= 5000 ms")
    if not np.isfinite(rate_hz) or not 0 < rate_hz <= 1000:
        raise ValueError("stimulation rate must be finite, > 0 and <= 1000 Hz")
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed < 2**32:
        raise ValueError("seed must be a uint32 integer")
    manifest = json.loads((ROOT / "reference-manifest.json").read_text())
    reference = ROOT / "reference"
    for entry in manifest["files"]:
        if not verified(reference / entry["name"], entry):
            raise RuntimeError(f"Missing or changed reference file: {entry['name']}. Run fetch_reference.py.")
    output = Path(output) if output else ROOT / "results" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    output.mkdir(parents=True, exist_ok=False)
    spec = importlib.util.spec_from_file_location("flywire_reference", reference / "model.py")
    author_model = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(author_model)
    b2.start_scope()
    # NumPy avoids a compiler prerequisite for the first reproducible local check.
    b2.prefs.codegen.target = "numpy"
    b2.defaultclock.dt = 0.1 * b2.ms
    b2.seed(seed)
    params = dict(author_model.default_params)
    # Upstream assigns an undeclared neuron variable `w` in its reset string.
    # `w` belongs to Synapses; removing this unused assignment permits modern Brian2.
    # The published voltage and conductance resets are retained.
    params["eq_rst"] = "v = v_rst; g = 0 * mV"
    params["r_poi"] = rate_hz * b2.Hz
    neurons_path = reference / "2023_03_23_completeness_630_final.csv"
    connections_path = reference / "2023_03_23_connectivity_630_final.parquet"
    neurons = pd.read_csv(neurons_path, index_col=0)
    ids = sugar_ids(reference / "example.ipynb")
    lookup = {int(fly_id): i for i, fly_id in enumerate(neurons.index)}
    excited = [lookup[fly_id] for fly_id in ids]
    start = perf_counter()
    print("Building the full FlyWire v630 reference network…", flush=True)
    neu, syn, spikes = author_model.create_model(neurons_path, connections_path, params)
    inputs, neu = author_model.poi(neu, excited, [], params)
    net = b2.Network(neu, syn, spikes, *inputs)
    net.store("initial")
    build_seconds = perf_counter() - start
    experiments = []
    for name in ("baseline", "sugar", "sugar_disconnected", "sugar_repeat"):
        net.restore("initial", restore_random_state=True)
        for stimulus in inputs:
            stimulus.active = name != "baseline"
        if name == "sugar_disconnected":
            # Preserve the stimulated neurons, but prevent them driving the graph.
            for index in excited:
                syn.w[f"i == {index}"] = 0 * b2.mV
        print(f"Running {name}: {duration_ms:g} ms", flush=True)
        start = perf_counter()
        net.run(duration_ms * b2.ms, namespace={})
        wall_seconds = perf_counter() - start
        indices = np.asarray(spikes.i[:], dtype=np.int32)
        times_ms = np.asarray(spikes.t[:] / b2.ms, dtype=np.float64)
        downstream = ~np.isin(indices, excited)
        counts = np.asarray(spikes.count[:])
        active = np.flatnonzero(counts)
        np.savez_compressed(output / f"{name}.npz", indices=indices, times_ms=times_ms)
        experiments.append({
            "name": name,
            "spikes": int(len(indices)),
            "active_neurons": int(len(active)),
            "downstream_spikes": int(downstream.sum()),
            "wall_seconds": wall_seconds,
            "simulation_seconds_per_wall_second": duration_ms / 1000 / wall_seconds,
            "top_active": [
                {"flywire_id": str(neurons.index[i]), "spikes": int(counts[i])}
                for i in sorted(active, key=lambda i: int(counts[i]), reverse=True)[:20]
            ],
        })
    by_name = {trial["name"]: trial for trial in experiments}
    with np.load(output / "sugar.npz") as first, np.load(output / "sugar_repeat.npz") as repeat:
        reproducible = np.array_equal(first["indices"], repeat["indices"]) and np.array_equal(first["times_ms"], repeat["times_ms"])
    checks = {
        "inactive_baseline": by_name["baseline"]["spikes"] == 0,
        "stimulus_fires": by_name["sugar"]["spikes"] > 0,
        "connectivity_propagates": by_name["sugar"]["downstream_spikes"] > 0,
        "disconnect_blocks_propagation": by_name["sugar_disconnected"]["downstream_spikes"] == 0,
        "seeded_repeat_matches": bool(reproducible),
    }
    summary = {
        "dataset": manifest["dataset"], "source_commit": manifest["commit"],
        "paper": manifest["paper"], "neurons": len(neu), "directed_connections": len(syn),
        "input_flywire_ids": [str(i) for i in ids], "seed": seed,
        "duration_ms": duration_ms, "dt_ms": 0.1, "rate_hz": rate_hz,
        "engine": f"Brian2 {b2.__version__}, numpy CPU target",
        "reset_compatibility_change": "Removed undeclared w assignment; voltage and conductance resets unchanged.",
        "build_seconds": build_seconds,
        "peak_process_rss_mb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024**2 if sys.platform == "darwin" else 1024),
        "experiments": experiments, "checks": checks,
        "scope": "Short synthetic stimulation and connectivity check. Not a reproduction of paper-level accuracy or a behaving fly. Not MaleCNS.",
    }
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({"output": str(output), "neurons": len(neu), "connections": len(syn), "checks": checks}, indent=2))
    if require_checks and not all(checks.values()):
        raise RuntimeError("Reference check failed; inspect summary.json")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--duration-ms", type=float, default=200)
    parser.add_argument("--seed", type=int, default=90210)
    parser.add_argument("--rate-hz", type=float, default=150)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    run(args.duration_ms, args.seed, args.rate_hz, args.output)
