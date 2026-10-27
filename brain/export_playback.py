"""Build a bounded browser view from actual Brian2 spike recordings."""

import argparse
from collections import deque
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
LABELS = {"baseline": "No stimulus", "sugar": "Intact", "sugar_disconnected": "Disconnected", "sugar_repeat": "Seeded repeat"}


def export_playback(directory, destination=None):
    directory = Path(directory)
    summary = json.loads((directory / "summary.json").read_text())
    neurons = pd.read_csv(ROOT / "reference/2023_03_23_completeness_630_final.csv", index_col=0)
    if len(neurons) != summary["neurons"]:
        raise ValueError("Recorded neuron count does not match reference data")
    lookup = {str(fly_id): i for i, fly_id in enumerate(neurons.index)}
    inputs = [lookup[fly_id] for fly_id in summary["input_flywire_ids"]]
    arrays, counts, totals = {}, {}, np.zeros(len(neurons), dtype=np.int64)
    for trial in summary["experiments"]:
        key = trial["name"]
        with np.load(directory / f"{key}.npz", allow_pickle=False) as spikes:
            indices, times = spikes["indices"].copy(), spikes["times_ms"].copy()
        if len(indices) != trial["spikes"] or len(times) != len(indices):
            raise ValueError(f"Inconsistent spike file: {key}")
        if not np.isfinite(times).all() or (times < 0).any() or (times >= summary["duration_ms"]).any():
            raise ValueError(f"Invalid recorded spike times: {key}")
        if (indices < 0).any() or (indices >= len(neurons)).any():
            raise ValueError(f"Invalid recorded neuron index: {key}")
        counts[key] = np.bincount(indices, minlength=len(neurons))
        totals = np.maximum(totals, counts[key])
        arrays[key] = (indices, times)
    # Keep input IDs even if they happen not to fire in a short low-rate run.
    ranked = sorted(np.flatnonzero(totals), key=lambda i: (-int(totals[i]), int(i)))
    selected = inputs + [int(i) for i in ranked if i not in inputs][:256 - len(inputs)]
    selected_set = set(selected)
    con = pd.read_parquet(
        ROOT / "reference/2023_03_23_connectivity_630_final.parquet",
        columns=["Presynaptic_Index", "Postsynaptic_Index", "Excitatory x Connectivity"],
    )
    local = con[con["Presynaptic_Index"].isin(selected_set) & con["Postsynaptic_Index"].isin(selected_set)]
    adjacency = {}
    for pre, post, weight in local.itertuples(index=False, name=None):
        if weight:
            adjacency.setdefault(pre, []).append(post)
    depth = {i: 0 for i in inputs}
    queue = deque(inputs)
    while queue:
        pre = queue.popleft()
        for post in adjacency.get(pre, []):
            if post not in depth:
                depth[post] = depth[pre] + 1
                queue.append(post)
    nodes = [{
        "index": i, "id": str(neurons.index[i]), "input": i in inputs,
        "layer": min(depth.get(i, 5), 5),
        "counts": {key: int(c[i]) for key, c in counts.items()},
    } for i in selected]
    local = local.assign(magnitude=local["Excitatory x Connectivity"].abs())
    local = local[local["magnitude"] > 0].sort_values(
        ["magnitude", "Presynaptic_Index", "Postsynaptic_Index"], ascending=[False, True, True], kind="stable",
    ).head(600)
    edges = [{"source": int(pre), "target": int(post), "weight": int(weight)}
             for pre, post, weight in local.iloc[:, :3].itertuples(index=False, name=None)]
    conditions = []
    for trial in summary["experiments"]:
        key = trial["name"]
        indices, times = arrays[key]
        visible = np.flatnonzero(np.isin(indices, selected))
        # Keep every spike for normal runs; bound the browser payload for dense activity.
        shown = visible if len(visible) <= 100000 else visible[np.linspace(0, len(visible) - 1, 100000, dtype=int)]
        conditions.append({
            "key": key, "label": LABELS[key], "total_spikes": trial["spikes"],
            "active_neurons": trial["active_neurons"], "downstream_spikes": trial["downstream_spikes"],
            "input_spikes": trial["spikes"] - trial["downstream_spikes"],
            "wall_seconds": trial["wall_seconds"],
            "selected_spike_count": int(len(visible)), "events_sampled": len(shown) < len(visible),
            "events": [[round(float(times[j]), 4), int(indices[j])] for j in shown],
            "histogram": np.histogram(times, bins=40, range=(0, summary["duration_ms"]))[0].tolist(),
        })
    payload = {
        "schema": "brain-lab-v1", "recorded_at": directory.name,
        "dataset": summary["dataset"], "paper": summary["paper"],
        "source_commit": summary["source_commit"], "neurons": summary["neurons"],
        "directed_connections": summary["directed_connections"], "duration_ms": summary["duration_ms"],
        "rate_hz": summary["rate_hz"], "seed": summary["seed"], "dt_ms": summary["dt_ms"],
        "engine": summary["engine"], "peak_process_rss_mb": summary["peak_process_rss_mb"],
        "checks": summary["checks"], "nodes": nodes, "edges": edges, "conditions": conditions,
        "projection": "Up to 256 input/active neurons and 600 strongest connections within that subset. Layers are graph distances within the displayed subset, capped at 5; this is not anatomical positioning. The simulation uses the full reference graph.",
    }
    destination = Path(destination) if destination else directory / "playback.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".partial")
    temporary.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    temporary.replace(destination)
    return payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = export_playback(args.directory, args.output)
    print(json.dumps({"nodes": len(result["nodes"]), "edges": len(result["edges"]), "conditions": len(result["conditions"])}))
