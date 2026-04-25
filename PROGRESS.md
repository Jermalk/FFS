# PROGRESS.md

Tracks validation work and design decisions across sessions.

## Project Background

Forest ecosystem cellular automaton simulator. Built by Jerzy (system designer) using Gemini for code generation. Jerzy designed the simulation logic; the code implements his intent.

## Current Status

**Phase: Core Assumption Validation**

Goal: Verify that the generated code correctly implements the intended system logic. Identify bugs, miscalibrated constants, and design gaps before adding new features.

## Validation Checklist

- [ ] Water balance — does normal-scenario inflow/outflow math sustain a healthy forest and stress it correctly under heat/drought?
- [ ] Seasonal logic — do season modifiers produce realistic annual cycles?
- [ ] Fire mechanics — are flammability values and fire danger thresholds scaled sensibly?
- [ ] Sensitivity parameter — does it meaningfully differentiate Optimistic/Pessimistic scenarios?
- [ ] Edge/boundary bug — `hasBurningNeighbor()` reads out-of-bounds array indices for cells on canvas edges (JS returns `undefined`, no crash, but incorrect fire spread behavior at edges)

## Known Issues / Findings

### Bug: hasBurningNeighbor() boundary reads
- **Location:** `simulation.js:258–268`
- **Problem:** Offsets like `-width-1` applied to edge cells go out of bounds. `Uint8Array[out-of-bounds]` returns `undefined`, which is falsy — so fires never "wrap" but the check is semantically wrong and may interact with type coercion unexpectedly.
- **Status:** Identified, not yet fixed. Will fix as its own commit.

## Commit Log Summary

| Commit | Description |
|--------|-------------|
| initial | Initial project files: index.htm, simulation.js, CLAUDE.md, PROGRESS.md |
