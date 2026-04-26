# Fire Mechanics Model Notes

Tracks identified issues and design decisions for the fire subsystem in `simulation-engine.js`.

---

## Issue Registry

### F1 — hasBurningNeighbor reads out-of-bounds indices at grid edges
**Status:** Fixed (commit bc4fda2)

**Problem:** The 8 neighbor offsets `[-w-1, -w, -w+1, -1, +1, w-1, w, w+1]` were applied unconditionally. For cells on the left edge (col=0) the offsets `-w-1`, `-1`, `w-1` pointed to the previous/next row's last column — a phantom horizontal wrap. For cells on the right edge (col=w-1) the offsets `-w+1`, `+1`, `w+1` pointed to the next/prev row's first column. For top-edge cells (row=0) negative indices into a Uint8Array return `undefined` (falsy — no fire wrap, but semantically wrong). For bottom-edge cells (row=h-1) indices exceeding `size` similarly return `undefined`.

**Fix:** Replaced unconditional offset table with an explicit bounds-checked loop: compute `x = i % w`, `y = i / w | 0`, then skip each of the 8 directional reads when the neighbor coordinate falls outside `[0, w-1]` × `[0, h-1]`.

**Impact:** Fire no longer "sees" phantom burning neighbors from the opposite side of a row. Edge cells are now treated correctly as having 3 or 5 real neighbors instead of 8.

---

### F2 — environmentalFlam steps to a 0.95 hard cap above fireDangerIndex 1.5
**Status:** Fixed (smooth linear ramp, cap 0.80)

**Problem:**
```js
let environmentalFlam = this.fireDangerIndex * 0.6;
if (this.fireDangerIndex > 1.5) environmentalFlam = 0.95;
```
The linear ramp (max = 1.5 × 0.6 = 0.90) jumps discontinuously to 0.95 at fdi > 1.5, then stays flat. This means:
- All fdi values above 1.5 are treated identically (no gradient).
- Old-growth trees (baseFlam=0.05) get totalFlam = min(1.0, 0.05 + 0.95) = **1.00** — guaranteed ignition when fdi > 1.5. This is ecologically extreme and removes all stochasticity for old-growth under high fire danger.
- Mediterranean summer dry spells routinely reach fdi ~2.6 (measured), so this saturated regime is common, not a corner case.

**Proposed fix:** Replace the step with a smooth sigmoid or an extended linear ramp capped at 0.80, e.g.:
```js
const environmentalFlam = Math.min(0.80, this.fireDangerIndex * 0.4);
```
This preserves a gradient throughout and leaves at least 15% stochasticity for old-growth even at extreme danger.

---

### F3 — pLightning uses three discrete step levels — no gradient
**Status:** Open (identified, not yet fixed)

**Problem:**
```js
let pLightning = 0.00001 * this.params.fireFreq;
if (this.fireDangerIndex > 1.0) pLightning = 0.0002 * this.params.fireFreq;
if (this.fireDangerIndex > 2.0) pLightning = 0.002  * this.params.fireFreq;
```
Three step levels create 20× and 10× discontinuous jumps at fdi=1.0 and fdi=2.0. A simulation running near fdi=1.0 will have wildly different ignition behaviour depending on which side of the threshold it is on in any given tick.

**Measured behaviour (FM-5 test):** Over 20 ticks with a maintained full forest:
- Cool+wet (fdi≈0.27): ~80 ignitions
- Hot+dry (fdi≈2.5): ~15,000 ignitions

The 200× ratio is driven by the step, not a smooth ecological response. This makes fire frequency very sensitive to exact fdi values near the thresholds.

**Proposed fix:** Continuous exponential scaling:
```js
const pLightning = 0.00001 * Math.pow(10, Math.min(this.fireDangerIndex, 3)) * this.params.fireFreq;
```
This gives a smooth 1000× range from fdi=0 to fdi=3 with no discontinuities.

---

### F4 — Sapling baseFlam 0.80 makes young forests always fire-prone
**Status:** Open (identified, calibration question)

**Problem:** `baseFlam = 0.80` for age 0–5. This means a sapling adjacent to any burning cell has an 80% per-tick ignition chance regardless of environmental conditions. In practice, with 8 neighbors each checked independently, a sapling surrounded by full saplings in any fire will almost certainly ignite on the next tick. Measured (FM-2): average 86% of neighbors ignite.

**Observation:** This may be ecologically intentional — young conifer stands (lodgepole pine, etc.) are genuinely explosive. However, the value is hard-coded with no connection to climate or species type. As the climate presets diversify, a tropical forest vs a boreal forest may warrant different sapling flammability.

**Current status:** Accepted as-is pending design decision on species-level parameterisation.

---

### F5 — fireDangerIndex tempStress baseline 15°C may be too high for boreal
**Status:** Open (calibration observation)

**Calculation:**
```js
const tempStress = Math.max(0, (this.currentTemp - 15) / 25);
```

The threshold of 15°C means any temperature below 15°C contributes zero heat stress. For Boreal climate (BASE_TEMP=4°C), even summer peaks (4+16=20°C) only yield tempStress=0.2. Boreal fire danger is dominated entirely by soilStress. This is not necessarily wrong — boreal fire is primarily a drought phenomenon — but it means temperature-driven fire feedback is disabled for the coldest presets.

**No change planned for now.** Fire danger in Boreal is driven by soilStress, which is realistic (e.g. 1988 Yellowstone fires were drought-driven, not heat-driven).

---

## Calibration Observations

| Scenario | Metric | Value | Notes |
|----------|--------|-------|-------|
| FM-2 | Avg neighbors igniting (sapling, fdi≈0) | 6.9/8 (86%) | Consistent with baseFlam=0.80 |
| FM-3 | Sapling cover lost in 15 seasons | 37% | 100×100 grid, 15 burning cells initial |
| FM-3 | Old-growth cover lost in 15 seasons | 23% | Meaningful resistance difference confirmed |
| FM-4 | fdi cool+wet (ta=0, rb=2.0) | 0.38 | Below lightning tier 1 |
| FM-4 | fdi warm+mild (ta=5, rb=0.8) | 0.90 | Below tier 1 |
| FM-4 | fdi hot+dry (ta=8, rb=0.2) | 2.95 | Well into tier 2 |
| FM-5 | Lightning fires/20 ticks, cool+wet | ~80 | Base rate |
| FM-5 | Lightning fires/20 ticks, hot+dry | ~15,000 | Tier 2 rate — extreme |

The FM-5 ratio (~190×) reveals the severity of F3's step function. This is a priority fix if realistic fire frequency is desired.
