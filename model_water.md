# Water Model — Design & Science Reference

Tracks design decisions, scientific grounding, and issue log for the water/soil subsystem.
Each numbered issue has its own fix entry so changes can be committed and reverted independently.

---

## Current Implementation (baseline)

`soilWater` is a single float [0, 1] updated every tick in `updateWeather()`.

```
inflow  = currentRain × 0.15 × absorptionEfficiency
outflow = 0.03 (basal) + tempEvap (heat-driven)
soilWater += inflow − outflow
soilWater  = clamp(soilWater, 0, 1)
```

`soilWater` feeds four downstream systems:

| Downstream | Expression | Layer |
|---|---|---|
| Growth rate | `pGrowth = 0.008 × soilWater / sensitivity` | Vegetation |
| Slow dieback | `pDieback = 0.02 × s` when `soilWater < 0.13 × s` | Vegetation |
| Collapse dieback | `pDieback = 0.20 × s` when `soilWater < 0.01` | Vegetation |
| Fire danger | `soilStress = 1 − soilWater` → `fireDangerIndex` | Fire |

---

## Scientific Background

### Soil water phases

Real soil holds water across three phases:

| Phase | Soil water content | Plant availability |
|---|---|---|
| Wilting point | < ~10% of field capacity | None — plants die |
| Stress zone | 10–40% | Reduced — stomata close |
| Optimal zone | 40–80% | Full growth |
| Field capacity | ~80% | Good but approaching limit |
| Saturation | > 80–100% | Anaerobic — oxygen blocked |
| Flooding | > 100% (surface ponding) | Root asphyxiation, mortality |

The model `soilWater` maps roughly to volumetric water content (VWC). The upper half of the range [0.5–1.0] is currently undifferentiated — all treated as equally beneficial.

### Transpiration

Forests are major consumers of soil water via transpiration. A closed canopy (100% cover) transpires 400–700 mm/year depending on species and temperature. Bare ground transpires only through direct evaporation, which is much lower. This creates a **self-regulating feedback loop**: dense forest draws down soilWater → reduced soilWater → reduced growth → forest thins → soilWater recovers.

Without this feedback, wet conditions cause max growth, max cover causes no extra water draw, soilWater stays high indefinitely — a perpetual-moisture runaway.

### Infiltration and runoff (Horton overland flow)

Infiltration rate (how fast soil absorbs rain) depends on **both** rainfall intensity and **soil saturation state**:
- Dry soil: high infiltration capacity, most rain absorbed
- Saturated soil: near-zero infiltration, almost all rain becomes surface runoff
- Intermediate: nonlinear — approximated by Green-Ampt or Philip models

Current model only checks rain intensity (`rain > 0.8`), ignoring soil saturation state entirely.

### Root asphyxiation (anaerobic stress)

When pore spaces fill with water, oxygen cannot reach roots. Most temperate forest species begin showing stress above 85–90% soil saturation. Duration matters: brief flooding (1–2 weeks) is tolerated; prolonged saturation causes root rot (Phytophthora) and mortality. Flood-tolerant species (e.g., willow, alder) can survive weeks; upland conifers die within days.

The model has no upper-bound mortality — `pDieback = 0` at `soilWater = 1.0`.

---

## Issues & Fix Plan

Each issue is self-contained. Tackle and commit individually.

---

### ISSUE-W1 — Waterlogging causes zero mortality (model is one-sided)

**Problem:**
`pDieback` only fires for drought. At `soilWater = 1.0`, mortality is zero and growth is maximum. The model has no concept of root asphyxiation.

**Math proof:**
```
soilWater = 1.0 → pDieback = 0, pGrowth = 0.008 (maximum)
soilWater = 0.0 → pDieback = 0.20 × sensitivity, pGrowth = 0
```
The stress function is a half-parabola anchored at zero — it has no right-side arm.

**Proposed fix:**
Add a waterlogging dieback probability that mirrors the drought logic but on the upper end:
```
if soilWater > 0.92:  pWaterlog = 0.01 × sensitivity   // slow suffocation
if soilWater > 0.98:  pWaterlog = 0.08 × sensitivity   // acute flooding
```
Old-growth trees (age > 25) are more vulnerable (deeper roots = deeper anaerobic zone):
apply `pWaterlog × 1.5` for old-growth cells.

**Cross-layer impact:** Vegetation (dieback path in update loop). No change to fire or climate.

**Status:** Done — commit `fix/W1`

**Notes:** Implemented as two independent `Math.random()` checks so drought and waterlogging stress are additive for small probabilities. Old-growth multiplier applied to `effectivePWaterlog` per cell inside the loop. Combined effect at `soilWater=0.98`, old growth: `pDieback=0` + `0.08×1.5×sensitivity = 0.12` — roughly symmetric with acute drought collapse (0.20).

---

### ISSUE-W2 — pGrowth is monotonically linear — no ecological optimum

**Problem:**
```javascript
pGrowth = 0.008 × soilWater / sensitivity
```
Growth increases linearly all the way to `soilWater = 1.0`. Real species have a bell-curve response — growth peaks around field capacity (~70% VWC) and falls off at both extremes.

**Math proof:**
At `soilWater = 1.0`, `pGrowth = 0.008` — the maximum ever possible. A flooded forest regenerates at peak speed.

**Proposed fix:**
Replace linear with a response curve that peaks at ~0.70 and drops off above it:
```
optimal  = 0.70
if soilWater <= optimal:
    moisture_factor = soilWater / optimal          // linear rise 0→1
else:
    excess = (soilWater - optimal) / (1 - optimal) // 0→1 past optimum
    moisture_factor = 1 - (excess² × 0.6)          // falls to 0.4 at soilWater=1
pGrowth = 0.008 × moisture_factor / sensitivity
```
At `soilWater = 1.0`: `moisture_factor = 1 - (1 × 0.6) = 0.4`, so `pGrowth = 0.0032` — 60% suppressed vs current maximum. Drought side is unchanged.

**Cross-layer impact:** Vegetation (growth path in update loop). No change to fire or climate.

**Status:** Done — commit `fix/W2`

**Notes:** Quadratic suppression coefficient 0.6 chosen so pGrowth at full saturation = 40% of peak — growth is suppressed but not zeroed (flood-tolerant seedlings can still establish). Drought side (soilWater ≤ 0.70) is mathematically identical to the old linear formula scaled to peak at 0.70 instead of 1.0.

---

### ISSUE-W3 — Outflow is biomass-blind (no transpiration feedback)

**Problem:**
```javascript
outflow = basalMetabolism + tempEvap
```
Identical whether the forest covers 0% or 100% of the grid. A dense canopy pulls far more water than bare ground, but this feedback is entirely missing. Without it, wet conditions → max growth → max cover → no extra water draw → soilWater stays maxed indefinitely.

**Scientific basis:**
Transpiration scales roughly linearly with leaf area index (LAI) up to full canopy closure. A closed canopy transpires ~2–4× more than bare ground at the same temperature.

**Proposed fix:**
Add a transpiration term scaled by current biomass fraction:
```
biomassFraction = stats.biomass / size     // 0→1
transpirationRate = 0.02 × biomassFraction × (currentTemp / 20) × sensitivity
outflow = basalMetabolism + tempEvap + transpirationRate
```
At 100% biomass, 20°C: adds 0.02 extra outflow/tick, creating meaningful self-regulation.
At 0% biomass: adds nothing (bare ground, expected).

Note: `stats.biomass` is computed at end of `update()` but `updateWeather()` runs first each tick. Will need to use the previous tick's biomass count (acceptable one-tick lag).

**Cross-layer impact:** Water balance (outflow term). Vegetation indirectly (less soilWater → affects pGrowth, pDieback). No direct fire change.

**Status:** Open

---

### ISSUE-W4 — Runoff ignores soil saturation state (Horton flow missing)

**Problem:**
```javascript
if (this.currentRain > 0.8) absorptionEfficiency = 0.6;
```
- Binary step: efficiency jumps from 1.0 to 0.6 at exactly `rain = 0.8`
- Depends only on rain intensity, not on whether soil is already saturated
- At `soilWater = 0.99` even light rain is fully absorbed — inverted from reality
- Autumn edge case: `rain = 0.80` is NOT `> 0.8`, so gets full absorption (0.12 inflow — highest of any season)

**Scientific basis (Horton overland flow):**
Runoff = f(rain intensity, soil saturation). At full saturation, infiltration capacity → 0 regardless of rain intensity.

**Proposed fix:**
Replace the binary rain check with a two-factor absorption efficiency:
```
// Rain intensity factor: smooth degradation above 0.6
rainFactor = rain > 0.6 ? 1 - ((rain - 0.6) / 0.4) × 0.5 : 1.0
// Soil saturation factor: soil above 0.8 increasingly rejects water
soilFactor = soilWater > 0.8 ? 1 - ((soilWater - 0.8) / 0.2) × 0.8 : 1.0
absorptionEfficiency = rainFactor × soilFactor
```
At `rain=1.0, soilWater=1.0`: efficiency = `0.5 × 0.2 = 0.10` (90% runoff) vs current 0.6 (40% runoff).
At `rain=0.5, soilWater=0.5`: efficiency = `1.0 × 1.0 = 1.00` (unchanged).

**Cross-layer impact:** Water inflow only. Tightens the upper bound on soilWater.

**Status:** Done — commit `fix/W4`

**Observed calibration shift:** Annual net at normal conditions drops from +0.040 to ~+0.027/year. Equilibrium soilWater at normal settings expected to settle ~0.55–0.65 instead of ~0.70+. At max rain bias with soilWater=1.0 the net becomes negative (inflow 0.015 < outflow 0.047 in spring), creating a natural drainage ceiling.

---

### ISSUE-W5 — Surplus water silently discarded (no flood signal)

**Problem:**
```javascript
this.soilWater = Math.max(0, Math.min(1, this.soilWater));
```
Any inflow beyond capacity vanishes without effect. There is no flood event, no surface saturation signal, and no interaction with fire suppression or dieback beyond what soilWater=1.0 already (incorrectly) provides.

**Proposed fix (minimal — flag only, no new state variable):**
Compute overflow before clamping and use it as a flood signal affecting fire danger:
```
const overflow = Math.max(0, soilWater - 1.0)   // water above capacity
this.soilWater = Math.min(1.0, soilWater)

// Surface flooding suppresses fire further (water on ground)
// and amplifies waterlogging mortality (already in ISSUE-W1)
this.floodIndex = Math.min(1, overflow × 20)     // 0→1 over 0.05 overflow
```
`floodIndex` can modify `fireDangerIndex` (reduce it when flooded) and feed into ISSUE-W1's waterlogging mortality. Adds minimal state.

**Cross-layer impact:** Fire model (`fireDangerIndex` reduction). Vegetation (feeds W1 waterlogging). No climate change.

**Status:** Open

---

## Cross-Layer Dependency Map

```
soilWater
  ├── INFLOW:  rain × absorptionEfficiency(rain, soilWater)  ← W4
  ├── OUTFLOW: basalMetabolism + tempEvap + transpiration(biomass) ← W3
  ├── OVERFLOW: floodIndex signal  ← W5
  │
  ├── Vegetation layer
  │     ├── pGrowth(soilWater) — bell curve  ← W2
  │     └── pDieback — drought + waterlogging  ← W1
  │
  └── Fire layer
        ├── soilStress = 1 − soilWater  (existing, correct)
        └── floodIndex modifier  ← W5
```

Recommended fix order: **W4 → W1 → W2 → W3 → W5**

Rationale: Fix inflow first (W4) so soilWater dynamics are more realistic before tuning the biological responses (W1, W2). Add transpiration feedback (W3) once growth/dieback are re-calibrated, because W3 changes the equilibrium soilWater level. W5 is additive and can go last.

---

## Calibration Targets (post-fix)

After all fixes, the system should satisfy:

| Scenario | Expected long-term soilWater |
|---|---|
| Normal / normal rain | 0.50–0.70 (healthy) |
| Max rain bias | 0.80–0.92 (wet but viable) |
| Max rain + 0% biomass | Approaches 1.0 (no transpiration sink) |
| Max rain + 100% biomass | Self-regulates to 0.75–0.85 |
| Max temp anomaly / drought | Drops to 0.05–0.15 before dieback |
| Drought + 100% biomass | Faster collapse than drought alone |
