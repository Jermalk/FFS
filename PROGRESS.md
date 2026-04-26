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
| `model_seasonal_logic.md` | Seasonal / climate subsystem | 6 issues fixed (S1–S6) |
| `test_seasonal.htm` | Seasonal logic test runner | 42/42 checks passed (2026-04-26) |

## Validation Checklist

- [x] Water balance — analysed and fixed; all 5 issues resolved (see model_water.md)
- [x] Seasonal logic — all 6 issues fixed (S1–S6); see model_seasonal_logic.md
- [ ] Fire mechanics — are flammability values and fire danger thresholds scaled sensibly?
- [ ] Sensitivity parameter — does it meaningfully differentiate Optimistic/Pessimistic scenarios?
- [ ] Edge/boundary bug — `hasBurningNeighbor()` reads out-of-bounds array indices for cells on canvas edges

## Known Issues / Findings

### Bug: hasBurningNeighbor() boundary reads
- **Location:** `simulation.js:258–268`
- **Problem:** Offsets like `-width-1` applied to edge cells go out of bounds. `Uint8Array[out-of-bounds]` returns `undefined`, which is falsy — so fires never "wrap" but the check is semantically wrong and may interact with type coercion unexpectedly.
- **Status:** Identified, not yet fixed. Will fix as its own commit.

## Next Session Brief — Test Framework Implementation

**Goal:** Build a unified, modular test framework for all validation suites.
Full design agreed in session 3. Implement in this order, one commit per step:

### Step 1 — `issues.js` (registry)
Single source of truth for all model issues across all subsystems.
```javascript
export const ISSUES = {
    W1: { doc: 'model_water.md',          title: 'Waterlogging causes zero mortality',   status: 'fixed' },
    // ... W2–W5 ...
    S1: { doc: 'model_seasonal_logic.md', title: 'Summer rain can reach zero',           status: 'fixed' },
    // ... S2–S6 ...
    // F1, F2... added when fire mechanics work begins
};
```
Enables: framework validates `covers` IDs exist; JSON output embeds full issue context; gap detector spots uncovered issues.

### Step 2 — `test_framework.js`
Shared module imported by all test pages. Provides:
- `createSuite(id, title)` → returns `{ scenario, run }`
- `scenario(id, title, covers[], fn)` — `covers` is array of ISSUES keys; framework validates each ID exists
- `fn` receives `{ val, check, runYears, clearGrid, countTrees }` — injected helpers
- On completion: renders HTML, builds result JSON (with full issue context from registry), shows Download button
- Gap report at bottom: which ISSUES IDs have no test covering them (across this suite)
- Commit hash input field; pre-fills filename as `{suite}_{YYYY-MM-DD}_{commit}.json`

### Step 3 — Refactor `test_seasonal.htm`
Replace inline framework with `import { createSuite } from './test_framework.js'`. Scenarios move to `tests/seasonal_logic.js`. Shell becomes ~5 lines.

### Step 4 — Refactor `test.htm`
Same treatment for water model. Scenarios move to `tests/water_model.js`.

### Step 5 — `test_results/` directory structure
```
test_results/
  water_model/        ← committed JSON result files
  seasonal_logic/     ← committed JSON result files
  fire_mechanics/     ← (placeholder for future)
```
Re-run both suites after refactor to confirm still 42/42 and W-suite pass. Commit result JSONs.

### Design decisions locked
- **Per-suite `.htm` files** (not universal) — simpler loader, no dropdown complexity
- **`covers` tags reference `ISSUES` keys** — framework rejects unknown IDs at run time
- **Result JSON committed to repo** — full audit trail in git; filename = `{suite}_{date}_{commit}.json`
- **No SESSION_TEMPORARY.md** — git log + PROGRESS.md + model docs give sufficient recovery; PROGRESS.md committed at key milestones within sessions
- **Result JSON schema:**
```json
{
  "suite": "seasonal_logic",
  "timestamp": "2026-04-26T...",
  "commit": "fa18e9f",
  "passed": 42, "failed": 0, "total": 42,
  "uncovered_issues": [],
  "scenarios": [{
    "id": "SL-1", "title": "...",
    "covers": [{ "id": "S1", "title": "...", "doc": "...", "status": "fixed" }],
    "passed": 15, "failed": 0,
    "values": [{ "label": "...", "value": "..." }],
    "checks": [{ "label": "...", "pass": true, "detail": "..." }]
  }]
}
```

### Calibration observation (from SL-5 results)
Temperate soil water = 90% after 50yr — above target range (50–70%). Flagged for future calibration; not blocking current validation work.

---

## Session 3 Work (2026-04-26)

### Seasonal Logic — all 6 issues resolved

- **S1** — raised summer rMod −0.60→−0.45 so base rain is 0.05, not systematically zero
- **S2** — rebalanced all rMods to sum=0; BASE_RAIN is now true annual mean
- **S3** — rebalanced all tMods to sum=0; BASE_TEMP is now true annual mean
- **S4** — fixed simulation starting in Summer; now begins Year 1 / Spring on first tick
- **S5** — added `growthTempFactor` = clamp((T−5)/15, 0, 1); pGrowth=0 at ≤5°C (winter dormancy)
- **S6** — `CLIMATE_PRESETS` (5 presets: Temperate / Mediterranean / Tropical / Boreal / Semi-Arid); dropdown in settings drawer; `setClimate()` auto-resets; default changed to Temperate

All preset modifiers satisfy sum(tMod)=0, sum(rMod)=0 so BASE_TEMP/BASE_RAIN are true annual means. Full notes per issue in `model_seasonal_logic.md`.

---

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
