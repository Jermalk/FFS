# PROGRESS.md

Tracks validation work and design decisions across sessions.

## Project Background

Forest ecosystem cellular automaton simulator. Built by Jerzy (system designer) using Gemini for code generation. Jerzy designed the simulation logic; the code implements his intent.

## Current Status

**Phase: Core Assumption Validation**

Goal: Verify that the generated code correctly implements the intended system logic. Identify bugs, miscalibrated constants, and design gaps before adding new features.

## Architecture Decisions

### Rendering: WebGL2 (Option B — state texture + fragment shader)
- Upload simulation state as a single RG8 texture (R=cell state 0/1/2, G=tree age) — 960KB/frame vs 1.92MB for RGBA pixel buffer
- Fragment shader maps `(state, age)` → color, removing all color computation from the CPU hot loop
- Dynamic viewport: canvas resizes to fill the available viewport; simulation grid stays at 800×600 internal resolution
- NEAREST filtering preserves the pixel-art look without `image-rendering: pixelated` CSS hack
- Letterboxing handled by `gl.viewport` to maintain 4:3 aspect ratio; letterbox bars cleared to background color

## Model Documentation Files

| File | Subsystem | Status |
|---|---|---|
| `model_water.md` | Water / soil moisture | 5 issues identified, fixes planned |

## Validation Checklist

- [x] Water balance — analysed and fixed; all 5 issues resolved (see model_water.md)
- [ ] Seasonal logic — do season modifiers produce realistic annual cycles?
- [ ] Fire mechanics — are flammability values and fire danger thresholds scaled sensibly?
- [ ] Sensitivity parameter — does it meaningfully differentiate Optimistic/Pessimistic scenarios?
- [ ] Edge/boundary bug — `hasBurningNeighbor()` reads out-of-bounds array indices for cells on canvas edges

## Known Issues / Findings

### Bug: hasBurningNeighbor() boundary reads
- **Location:** `simulation.js:258–268`
- **Problem:** Offsets like `-width-1` applied to edge cells go out of bounds. `Uint8Array[out-of-bounds]` returns `undefined`, which is falsy — so fires never "wrap" but the check is semantically wrong and may interact with type coercion unexpectedly.
- **Status:** Identified, not yet fixed. Will fix as its own commit.

## Commit Log Summary

| Commit | Description |
|--------|-------------|
| 5e5912f | initial: project files + CLAUDE.md + PROGRESS.md |
| 5e3a0fd | perf: pure rAF loop, DOM cache, cancel-on-pause |
| b2edae6 | feat: WebGL2 renderer — RG8 texture, fragment shader colour mapping, dynamic viewport |
| ba710ba | fix(W4): two-factor Horton infiltration — rain intensity + soil saturation |
| 9b66dfe | fix(W1): waterlogging dieback — anaerobic stress, old-growth 1.5× multiplier |
| 517fd15 | fix(W2): pGrowth bell-curve peaking at soilWater=0.70, 40% at saturation |
| 986c997 | fix(W3): biomass-driven transpiration outflow, coeff 0.012 for ~58% equilibrium |
| 1d9a032 | fix(W5): floodIndex from overflow — fire suppression + W1 mortality amplifier |
