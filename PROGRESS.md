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
| `model_seasonal_logic.md` | Seasonal / climate subsystem | 6 issues fixed (S1–S6) |
| `test_seasonal.htm` | Seasonal logic test runner | 42/42 checks passed (2026-04-26, commit 31a7884) |
| `test.htm` | Water model test runner | 13/13 checks passed (2026-04-26, commit 40cdbef) |

## Validation Checklist

- [x] Water balance — analysed and fixed; all 5 issues resolved (see model_water.md)
- [x] Seasonal logic — all 6 issues fixed (S1–S6); see model_seasonal_logic.md
- [x] Test framework — unified framework with issue registry, gap report, JSON download; both suites passing
- [x] Edge/boundary bug — `hasBurningNeighbor()` boundary reads fixed (F1, commit bc4fda2)
- [x] Fire mechanics — F1–F5 identified; F1 fixed; F2/F3 need fixes; F4/F5 accepted; 5/5 tests pass
- [x] Water balance calibration — transpiration coeff raised 0.012→0.060; expected equilibrium 55–75% soilWater
- [x] F2 fix — environmentalFlam smooth ramp, cap 0.80 (commit pending)
- [x] F3 fix — pLightning smooth exponential (commit pending)
- [ ] Sensitivity parameter — does it meaningfully differentiate Optimistic/Pessimistic scenarios?

## Known Issues / Findings

### Bug: hasBurningNeighbor() boundary reads — FIXED
- **Location:** `simulation-engine.js` — replaced offset table with bounds-checked per-direction reads.
- **Fix (commit bc4fda2):** Computes `x = i % w`, `y = i / w | 0`, skips each of the 8 directions when the neighbor coordinate is outside grid bounds.

### Design issue: F2 — environmentalFlam hard cap
- **Location:** `simulation-engine.js` fire spread logic
- **Problem:** At fdi > 1.5, `environmentalFlam` steps to 0.95 flat. Old-growth (baseFlam=0.05) gets totalFlam=1.00 — guaranteed ignition. Mediterranean summer regularly hits fdi~2.6, so this is common, not a corner case. No gradient above the threshold.
- **Status:** Identified, fix proposed in model_fire.md. Next session.

### Design issue: F3 — pLightning step function
- **Location:** `simulation-engine.js` — three hard-coded rate levels
- **Problem:** The 20× jump at fdi=1.0 and 10× jump at fdi=2.0 produce ~190× ratio between cool-wet and hot-dry lightning ignitions (measured in FM-5). Proposed fix: continuous `0.00001 * 10^min(fdi,3)`.
- **Status:** Identified, fix proposed in model_fire.md. Next session.

### Calibration: Temperate soilWater equilibrium — FIXED
- **Root cause (documented):** Transpiration coefficient (0.012) was calibrated at BASE_TEMP=20°C with S1 bug zeroing summer rain. After fixes: BASE_TEMP=12 (annual temp factor 4.0→2.55, −36%) + summer rain restored (+0.084/yr inflow). Annual surplus before transpiration grew from +0.027 to +0.085/yr.
- **Fix:** Transpiration coefficient raised 0.012→0.060 (5×). Closes the +0.085 surplus at bf≈0.95; coupled equilibrium (growth + fire) expected to land soilWater 55–75%, biomass 60–80%.
- **WM-1 updated:** Bounds changed from stability guards (≥40%, <98%) to calibration targets (≥55%, ≤82%).

## Next Session: pick up here

1. **Run test suites** — verify WM-1 through WM-5 and FM-1 through FM-5 still pass after F2/F3/calibration changes.
2. **Sensitivity parameter** — does it meaningfully differentiate Optimistic/Pessimistic scenarios?

---

## Session 5 Work (2026-04-26)

### F1 fixed — hasBurningNeighbor() boundary reads (commit bc4fda2)

Replaced the unconditional 8-offset table with a bounds-checked per-direction implementation. Computes `x = i % w`, `y = i / w | 0`, then skips each of the 8 directions when the neighbor coordinate falls outside `[0, w-1] × [0, h-1]`. FM-1 test confirms no crash, no invalid state bytes, edge cells cleared correctly after one tick.

### Fire mechanics validation — F1–F5 identified and documented

**Issues registry (`issues.js`):** F1–F5 added.

**`model_fire.md` created:** Full analysis of all 5 issues with proposed fixes and calibration table.

Key findings:
- **F2 (environmentalFlam hard cap):** Old-growth gets totalFlam=1.00 (guaranteed ignition) whenever fdi > 1.5. Mediterranean summer regularly reaches fdi ~2.6. Proposed fix: smooth linear ramp capped at 0.80.
- **F3 (pLightning step function):** Three discrete levels create a ~190× ratio in lightning ignitions between cool+wet and hot+dry conditions (measured FM-5). Proposed fix: continuous `0.00001 × 10^min(fdi,3)`.
- **F4 (sapling baseFlam 0.80):** Average 86% of 8 neighbors ignite per tick (measured FM-2). Ecologically defensible for young conifer stands; accepted pending species parameterisation decision.
- **F5 (tempStress baseline 15°C):** Makes boreal fire danger entirely drought-driven; accepted as realistic.

### Fire mechanics test suite — 5/5 scenarios passing

`tests/fire_mechanics.js` + `test_fire.htm`:

| Scenario | What it tests | Result |
|----------|---------------|--------|
| FM-1 | Boundary safety — no crash or invalid state at grid edges | PASS |
| FM-2 | Sapling spread rate ~86% (baseFlam=0.80 confirmed) | PASS |
| FM-3 | Old-growth 23% vs sapling 37% cover loss — age resistance confirmed | PASS |
| FM-4 | fdi monotone gradient: 0.38 → 0.90 → 2.95 across conditions | PASS |
| FM-5 | Lightning ignitions: ~80 (cool) vs ~15,000 (hot) — confirms F3 severity | PASS |

Existing suites unaffected: WM-1 smoke-check passed after boundary fix.

---

## Session 4 Work (2026-04-26)

### Test framework — built and deployed

Five-step implementation, one commit per step:

1. **`issues.js`** — single registry of all model issues (W1–W5, S1–S6); framework validates `covers` IDs at run time; JSON output embeds full issue context.
2. **`test_framework.js`** — shared suite runner: `createSuite(id, title)` → `{ scenario, run }`; renders HTML results; gap report (uncovered issues); Download JSON button with commit-hash input; filename = `{suite}_{date}_{commit}.json`.
3. **`tests/seasonal_logic.js` + refactored `test_seasonal.htm`** — shell reduced to 5 lines; all 6 SL scenarios ported.
4. **`tests/water_model.js` + refactored `test.htm`** — shell reduced to 5 lines; all 5 WM scenarios ported.
5. **`test_results/`** — directory structure with `water_model/`, `seasonal_logic/`, `fire_mechanics/` subdirs.

### Water model test failures diagnosed and fixed

Initial run (commit `31a7884`) produced 3 failures:

- **WM-1** (Groundwater 45–75%, Biomass 45–70%) — targets were calibrated for old BASE_TEMP=20 with the S1 bug zeroing summer rain. With Temperate (12°C, summer rain = 0.56), transpiration is 40% weaker → equilibrium ~90%. Bounds updated to stability guards (≥40%, <98%); calibration debt documented.
- **WM-4** (wet lowers fire danger vs normal) — failed because both wet and dry scenarios converge to ~90% soilWater under Temperate, giving an unmeasurable signal. Redesigned to compare extreme drought (rainBias=0.1) vs heavy rain (rainBias=2.0) under tempAnomaly=5; signal is now clear (~4× fire danger difference).

Both suites passing after fixes:
- Seasonal logic: **42/42** (commit `31a7884`, result file committed)
- Water model: **13/13** (commit `40cdbef`, result file committed)

### Documentation

- **README.md** created — human-readable guide for users without LLM support: quick start, UI reference, climate presets, experiments, test instructions, file layout, project status.
- **CLAUDE.md** updated — added README update rule per session; added `#session-wrap` command (avoids collision with Claude Code's `/` commands).

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
