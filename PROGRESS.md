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
| `model_water.md` | Water / soil moisture | All 5 fixes complete |
| `test_water_model.md` | Water model behaviour tests | 5 scenarios defined, not yet run |

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

## Session 2 Work (2026-04-26)

### Architecture Changes

**Engine/UI separation (`simulation-engine.js`)**
- Extracted pure `SimulationEngine` class into `simulation-engine.js` — zero DOM/WebGL dependencies
- `simulation.js` is now a thin wiring layer (GL renderer + UI + event listeners) that imports the engine
- Engine runs identically in browser and Node.js; used by `test.htm`

**Settings drawer**
- Merged settings drawer concept from temp branch: slide-out panel (left:-420px → 0) with CSS transition, backdrop blur
- Exposed all physics params: Temp Anomaly, Rainfall Bias, Model Sensitivity, Basal Metabolism, Growth Rate, Fire Frequency, Simulation Speed
- Tooltips (`.help-icon`) show description + default value on hover

**Render/sim decoupling**
- Removed "Render Speed (FPS)" slider — render runs at display refresh rate (rAF), always
- Simulation speed slider now correctly labelled; shows live measured yr/s in sidebar
- Energy-saving pattern: `draw()` only fires when `engine.update()` ran that frame

**History charts**
- Parallel numeric arrays (`history.year/temp/rain/soilWater/biomass/danger`) — O(1) append, ~8 bytes/entry
- "History Charts" button overlays a full-viewport canvas panel (Chart panel covers the sim grid)
- 4 stacked bands: Temperature, Rain & Soil Water, Biomass, Fire Danger
- Downsampled to canvas pixel width for fast render regardless of history size
- Dynamic temperature range per run; RAIN band overlays two series with legend

**Chart readability pass**
- Band titles: `#666` 10px → `#c0c0c0` 12px (WCAG AA on dark bg)
- Y-axis labels: `#444` 9px → `#888` 10px
- Legend labels: `#888` 9px → `#aaa` 10px
- X-axis year labels: `#555` 9px → `#888` 10px
- Grid lines: `#1c1c1c` → `#2a2a2a`; band separators: `#2a2a2a` → `#383838`
- PAD increased 10→16px to prevent title/data overlap

**Browser test runner (`test.htm`)**
- 5 behaviour scenarios for W1–W5 water model, run against `SimulationEngine` directly
- Requires `python3 -m http.server 8080` (ES modules blocked on `file://`)
- All 5 scenarios pass with current engine

### Open Items Carried Forward

- `hasBurningNeighbor()` boundary bug (edge cells) — identified, not yet fixed
- Seasonal logic validation — not yet done
- Fire mechanics calibration — not yet done
- Sensitivity parameter differentiation — not yet done

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
| 7c9928f | feat: settings drawer with exposed physics params |
| 4d47fb1 | refactor: extract SimulationEngine; add browser test runner |
| 76ff0fc | fix: decouple render from sim speed; show live fps and sim speed |
| a2302cf | fix: draw only on sim update; remove redundant render fps display |
| 72ebb77 | feat: history data collection and stacked chart overlay |
| 230b57f | style(chart): improve readability — larger fonts, higher contrast |
