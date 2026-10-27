"""Download the authors' pinned reference files and verify their Git blob hashes."""

import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent


def verified(path, spec):
    if not path.is_file() or path.stat().st_size != spec["bytes"]:
        return False
    h = hashlib.sha1(f"blob {spec['bytes']}\0".encode())
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest() == spec["git_blob_sha1"]


def main():
    manifest = json.loads((ROOT / "reference-manifest.json").read_text())
    target = ROOT / "reference"
    target.mkdir(exist_ok=True)
    for spec in manifest["files"]:
        path = target / spec["name"]
        if verified(path, spec):
            print(f"Verified {path.name}", flush=True)
            continue
        url = (
            "https://raw.githubusercontent.com/philshiu/Drosophila_brain_model/"
            f"{manifest['commit']}/{spec['name']}"
        )
        partial = path.with_suffix(path.suffix + ".partial")
        print(f"Downloading {path.name} ({spec['bytes'] / 1e6:.1f} MB)", flush=True)
        subprocess.run(
            ["curl", "--fail", "--location", "--silent", "--show-error", "--retry", "3",
             "--connect-timeout", "20", "--max-time", "300", "--output", str(partial), url],
            check=True,
        )
        if not verified(partial, spec):
            raise RuntimeError(f"Size or hash mismatch: {spec['name']}")
        partial.replace(path)
    print("Reference code and FlyWire v630 data are ready.")


if __name__ == "__main__":
    main()
