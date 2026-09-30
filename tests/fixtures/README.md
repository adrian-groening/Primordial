# Legacy characterization fixture

`legacy-v1.json` was captured before P00 formatting and validation. It contains exact reference states (digests and diagnostic summaries) for seed 90210, dt 1/30, and step counts 0, 30, and 1800, at three neural architectures.

The complete state is serialized through `legacy-state.mjs` using JSON.stringify, then SHA-256 hashed. Arrays and object key insertion order are preserved. A hash includes all live organism weights, traces, food, history, and RNG state. Metadata/backing fields introduced in P00 are deliberately outside this original-state projection.

Tests never regenerate the fixture. A deliberate future model change must receive a new version/fixture or preserve this legacy implementation separately. Do not replace expected hashes merely to make tests pass. Same-runtime exact equality is the guarantee; runtime/platform differences are printed on failure for investigation.

This is characterization, not a portable save format, trained brain asset, or scientific validation. Existing neural smoke tests consume extra RNG via a test-created offspring and disable mutation; their final counts intentionally differ from these uninterrupted runs.
