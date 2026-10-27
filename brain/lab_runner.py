"""Run and export a bounded Brain Lab experiment for the local server."""
import argparse
from pathlib import Path
from export_playback import export_playback
from run_reference import run

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--duration-ms", type=int, required=True)
    parser.add_argument("--rate-hz", type=int, required=True)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not 100 <= args.duration_ms <= 1000 or not 25 <= args.rate_hz <= 250:
        parser.error("Brain Lab supports 100–1000 ms and 25–250 Hz")
    # A valid low-input experiment need not elicit downstream spikes. Retain its
    # observed checks and recording instead of treating that outcome as a crash.
    run(args.duration_ms, args.seed, args.rate_hz, args.output, require_checks=False)
    print("Exporting recorded activity…", flush=True)
    export_playback(args.output)
