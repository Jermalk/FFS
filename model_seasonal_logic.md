# Seasonal Logic — Design & Science Reference

Tracks design decisions, scientific grounding, and issue log for the seasonal / climate subsystem.
Each numbered issue has its own fix entry so changes can be committed and reverted independently.

---

## Current Implementation (baseline)

Season cycles every 4 ticks: `season = ticks % 4`. One tick = one season; four ticks = one year.

`updateWeather()` adds fixed offsets to `BASE_TEMP = 20` and `BASE_RAIN = 0.5`:

| Season index | Label | tMod | rMod | Effective temp | Effective rain (pre-noise) |
|---|---|---|---|---|---|
| 0 | Spring | −5 | +0.20 | 15 °C | 0.70 |
| 1 | Summer | +12 | −0.60 | 32 °C | **−0.10 → clamps to 0** |
| 2 | Autumn | 0 | −0.10 | 20 °C | 0.40 |
| 3 | Winter | −10 | +0.10 | 10 °C | 0.60 |

Noise added each tick: `±1 °C` (temp), `±0.2 × volatility` (rain).

Season assignment in `update()`:
```javascript
this.ticks++;
if (this.ticks % 4 === 0) this.year++;
this.season = this.ticks % 4;
this.updateWeather();
```

Growth probability `pGrowth` is not seasonally modulated — it depends only on soil moisture.

---

## Scientific Background

### Climate seasonality in forests

Temperate and boreal forests rely on a predictable seasonal cycle to regulate growth, dormancy, and fire risk:

- **Spring**: Soil thaws, moisture peaks from snowmelt and rain; growth resumes.
- **Summer**: Heat peaks; rainfall varies by climate type; fire risk highest in dry climates.
- **Autumn**: Temperature drops; senescence; leaf litter accumulates; rain rises in some climates.
- **Winter**: Growth stops (dormancy); water locked as snow in boreal systems; low fire risk.

The amplitude and timing of seasonal swings differ dramatically between climate types — a Mediterranean summer and a temperate summer are not the same event.

### Key ecological consequences of seasonality

| Process | Seasonal driver |
|---|---|
| Growth (pGrowth) | Temperature + soil moisture; should near-zero in winter |
| Drought dieback | Soil moisture trough; peaks mid–late summer |
| Fire danger | Heat + moisture deficit; peaks in summer/early autumn |
| Waterlogging | Precipitation excess; peaks in winter/spring |

### Rain as an annual average

`BASE_RAIN` should represent the long-run annual mean precipitation. Seasonal modifiers should average to zero so the mean is preserved. If modifiers are net-negative, the forest operates permanently drier than the baseline implies — a hidden calibration bias.

---

## Issues & Fix Plan

Each issue is self-contained. Tackle and commit individually.

---

### ISSUE-S1 — Summer rain can reach zero (rMod too extreme)

**Problem:**
`BASE_RAIN + rMod = 0.5 − 0.6 = −0.10` before noise. With rain noise range ±0.20,
approximately half of all Summer ticks produce zero precipitation. Inflow = 0 while
peak-temperature evaporation is at its maximum — soilWater crashes unrealistically fast.

**Math proof:**
```
currentRain = max(0, -0.10 + noise)   where noise ∈ [-0.20, +0.20]
P(rain = 0) ≈ 0.5 in Summer
```

**Proposed fix:**
Rebalance summer rMod so a small baseline rain always exists. Target: driest season
should have at least 0.05 effective rain before noise.

**Status:** Done — commit `fix(S1)`

**Notes:** rMod changed from -0.60 → -0.45, giving base rain = 0.50 - 0.45 = 0.05 before noise. Noise ±0.20 can still produce zero on the worst tick, but the long-run mean is now 0.05 instead of the previous -0.10. Superseded by S6 climate presets where each preset defines its own summer rMod above this threshold.

---

### ISSUE-S2 — Annual rain average is structurally below BASE_RAIN

**Problem:**
Mean seasonal rMod = `(0.20 − 0.60 − 0.10 + 0.10) / 4 = −0.10`.
Effective long-run average rain = `(0.5 − 0.10) × rainBias = 0.40 × rainBias`.
`BASE_RAIN = 0.5` does not represent the actual annual mean — it is a misleading label.

**Proposed fix:**
Design seasonal modifiers so their mean = 0, making BASE_RAIN truly the annual average.
Each climate preset (see ISSUE-S6) must satisfy: `sum(rMod[0..3]) = 0`.

**Status:** Done — commit `fix(S2)`

**Notes:** Spring rMod 0.20→0.30, Autumn rMod -0.10→-0.05, Winter rMod 0.10→0.20. Sum: 0.30 - 0.45 - 0.05 + 0.20 = 0.00. BASE_RAIN=0.50 is now the true annual mean. Effective rains: Spring 0.80, Summer 0.05, Autumn 0.45, Winter 0.70.

---

### ISSUE-S3 — Annual temperature average is slightly below BASE_TEMP (minor)

**Problem:**
Mean seasonal tMod = `(−5 + 12 + 0 − 10) / 4 = −0.75 °C`.
Effective annual mean = 19.25 °C, not 20 °C.

**Proposed fix:**
Balance tMods to sum = 0 per preset (same constraint as S2).

**Status:** Done — commit `fix(S3)`

**Notes:** Autumn tMod 0→+1, Winter tMod -10→-8. Sum: -5+12+1-8=0. Effective temps: Spring 15°C, Summer 32°C, Autumn 21°C, Winter 12°C. BASE_TEMP=20 is now the true annual mean.

---

### ISSUE-S4 — Simulation starts in Summer, not Spring

**Problem:**
`init()` calls `updateWeather()` with `season = 0` (Spring conditions for initial state),
but the first `update()` immediately sets `season = 1 % 4 = 1` (Summer).
Year 0 is an incomplete year that begins mid-summer.

**Math proof:**
```
init():    season = 0  → updateWeather()  (Spring, one-time)
tick 1:    season = 1  → Summer
tick 2:    season = 2  → Autumn
tick 3:    season = 3  → Winter
tick 4:    season = 0  → Spring  (year 1 begins)
```
The display shows "Year 0 / Spring" on load, then immediately jumps to Summer on the first tick.

**Proposed fix (one line):**
Initialise `this.ticks = 3` in `init()` so the first `update()` produces `ticks=4, season=0`
(Spring) and `year=1`. Alternatively set `this.season = 3` before calling `updateWeather()` in init
and start year counter at 0 for the "pre-run" state.

**Status:** Done — commit `fix(S4)`

**Notes:** `this.ticks = 3` in init() so the first update() produces ticks=4, season=0 (Spring), year=1. Initial pause state displays Year 0 / Winter (pre-simulation). History recording begins at Year 1 / Spring.

---

### ISSUE-S5 — Growth rate is not seasonally modulated (no winter dormancy)

**Problem:**
`pGrowth` depends only on soil moisture. At `soilWater = 0.70`, growth probability is
identical in January and July. Real forests enter dormancy when temperature falls below
~5 °C; meristematic activity stops; seedlings do not establish in frozen ground.

**Ecological consequence:**
Winter is currently just "low temp + slightly higher rain" — it has no direct effect on
growth. A boreal winter at −16 °C and a temperate autumn at 13 °C produce the same
pGrowth if soil moisture matches.

**Proposed fix:**
Multiply `pGrowth` by a temperature-based growing-season factor:
```
growthTempFactor = clamp((currentTemp - 5) / 15, 0, 1)
  → 0 at ≤5 °C (full dormancy)
  → 1 at ≥20 °C (full growth potential)
pGrowth = 0.008 × moistureFactor × growthTempFactor × growthRate / sensitivity
```
This leaves summer growth unchanged (currentTemp ≥ 20 °C → factor = 1) while
suppressing winter growth proportionally to how far below 20 °C the temperature drops.

**Cross-layer impact:** Vegetation (growth path only). No change to fire or water balance.

**Status:** Done — commit `fix(S5)`

**Notes:** `growthTempFactor = clamp((currentTemp - 5) / 15, 0, 1)`. Zero at ≤5°C (full dormancy), 1 at ≥20°C (full growth potential). Summer growth unchanged. Boreal winter at −22°C: factor=0. Temperate winter at −3°C (after S6 preset): factor=0. Mediterranean winter at 10°C: factor=0.33 — partial suppression. Comment kept in code because the formula is a non-obvious design choice.

---

### ISSUE-S6 — Single hardcoded climate; no user choice

**Problem:**
Seasonal modifiers are hardcoded in `updateWeather()`. The only climate representable is
a hot-dry-summer / mild-wet-winter pattern (loosely Mediterranean). No other ecosystem
type (temperate, boreal, tropical wet/dry, semi-arid) is accessible.

**Proposed fix — climate preset system:**

Define named presets in `simulation-engine.js`. Each preset carries:
- `BASE_TEMP`, `BASE_RAIN` — annual means (true averages, not offsets)
- Four `{ tMod, rMod }` season objects, constrained so `sum(tMod) = 0` and `sum(rMod) = 0`

| Preset | BASE_TEMP | BASE_RAIN | Character |
|---|---|---|---|
| Temperate | 12 °C | 0.55 | Mild four seasons; rain distributed evenly |
| Mediterranean | 18 °C | 0.40 | Hot dry summer; mild wet winter |
| Tropical wet/dry | 27 °C | 0.60 | No cold season; alternating wet/dry |
| Boreal | 4 °C | 0.45 | Short warm summer; long harsh winter |
| Semi-arid | 22 °C | 0.28 | Chronically low rain; fire-prone |

Seasonal modifier design targets (balanced so mean = 0):

**Temperate**
| Season | tMod | rMod | Temp | Rain |
|---|---|---|---|---|
| Spring | +3 | +0.09 | 15 °C | 0.64 |
| Summer | +10 | +0.01 | 22 °C | 0.56 |
| Autumn | +2 | +0.05 | 14 °C | 0.60 |
| Winter | −15 | −0.15 | −3 °C | 0.40 |
| **Mean** | **0** | **0** | 12 °C | 0.55 |

**Mediterranean**
| Season | tMod | rMod | Temp | Rain |
|---|---|---|---|---|
| Spring | +2 | +0.15 | 20 °C | 0.55 |
| Summer | +12 | −0.35 | 30 °C | 0.05 |
| Autumn | +2 | +0.10 | 20 °C | 0.50 |
| Winter | −16 | +0.10 | 2 °C  | 0.50 |
| **Mean** | **0** | **0** | 18 °C | 0.40 |

**Tropical wet/dry**
| Season | tMod | rMod | Temp | Rain |
|---|---|---|---|---|
| Spring (dry onset) | +1 | −0.25 | 28 °C | 0.35 |
| Summer (peak dry) | +3 | −0.45 | 30 °C | 0.15 |
| Autumn (wet onset) | 0 | +0.30 | 27 °C | 0.90 |
| Winter (peak wet) | −4 | +0.40 | 23 °C | 1.00 (capped) |
| **Mean** | **0** | **0** | 27 °C | 0.60 |

**Boreal**
| Season | tMod | rMod | Temp | Rain |
|---|---|---|---|---|
| Spring | +6 | +0.08 | 10 °C | 0.53 |
| Summer | +16 | +0.04 | 20 °C | 0.49 |
| Autumn | +4 | +0.00 | 8 °C | 0.45 |
| Winter | −26 | −0.12 | −22 °C | 0.33 |
| **Mean** | **0** | **0** | 4 °C | 0.45 |

**Semi-arid**
| Season | tMod | rMod | Temp | Rain |
|---|---|---|---|---|
| Spring | +3 | +0.09 | 25 °C | 0.37 |
| Summer | +10 | −0.18 | 32 °C | 0.10 |
| Autumn | +2 | +0.05 | 24 °C | 0.33 |
| Winter | −15 | +0.04 | 7 °C | 0.32 |
| **Mean** | **0** | **0** | 22 °C | 0.28 |

**Implementation:**
- `CLIMATE_PRESETS` constant in `simulation-engine.js`
- `climateType` string in `this.params` (default `'temperate'`)
- `updateWeather()` reads `BASE_TEMP`, `BASE_RAIN`, and season modifiers from the active preset
- `setClimate(type)` updates params and calls `reset()`
- Dropdown added to settings drawer; changing climate auto-resets simulation

**Climate is orthogonal to sensitivity/fireFreq/etc.** — presets do not override those sliders.

**Status:** Done — commit `feat(S6)`

**Notes:** `CLIMATE_PRESETS` is exported so test runners and simulation.js can import it. Default climate changed from the interim hardcoded Mediterranean-ish values (BASE_TEMP=20, BASE_RAIN=0.50) to Temperate (BASE_TEMP=12, BASE_RAIN=0.55) — a better ecological baseline for a forest simulation. S1–S3 interim fixes to the hardcoded values are superseded by the preset definitions; each preset satisfies sum(tMod)=0 and sum(rMod)=0 by design. setClimate() calls reset() so history clears on climate change.

---

## Cross-Layer Dependency Map

```
Climate preset (S6)
  ├── BASE_TEMP, BASE_RAIN → updateWeather() inputs
  └── season[0..3] { tMod, rMod } → currentTemp, currentRain each tick

currentTemp
  ├── tempEvap outflow → soilWater
  ├── growthTempFactor (S5) → pGrowth
  └── tempStress → fireDangerIndex

currentRain (S1, S2 fixed per preset)
  └── inflow → soilWater

Season start (S4)
  └── init() ticks offset → first visible season = Spring
```

---

## Calibration Targets (post-fix)

After all S-series fixes, the system should satisfy:

| Scenario | Expected behaviour |
|---|---|
| Temperate, normal settings | Sustained forest ~50–65% cover; mild summer fire events |
| Mediterranean, normal settings | Cover oscillates; summer fire spikes; winter recovery |
| Boreal, normal settings | Slow growth; low fire; winter near-dormancy visible in biomass chart |
| Tropical wet/dry, normal settings | Fire spikes in dry season; dense canopy in wet season |
| Semi-arid, normal settings | Sparse cover; frequent fires; high sensitivity to rain bias |
| Any climate + max tempAnomaly | Accelerated drying and fire regardless of climate type |
