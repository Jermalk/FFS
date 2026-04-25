# Water Model — Behaviour Test Protocol

Validates that W1–W5 fixes produce realistic, calibrated behaviour.
Each scenario targets specific fixes. Run at max speed unless noted.

---

## Calibration Targets (reference)

| Scenario | Expected soilWater |
|---|---|
| Normal / normal rain | 50–70% |
| Max rain bias | 80–92% (not pinned at 100%) |
| Max rain + 100% biomass | Self-regulates to 75–85% |
| Max temp anomaly / drought | Drops to 5–15% before dieback |
| Drought + 100% biomass | Faster collapse than drought alone |

---

## Scenario 1 — Baseline Calibration

**Targets:** W3 biomass equilibrium, healthy water balance at normal settings

**Setup:**
- Reset world
- All sliders at default (Temp anomaly=0, Rainfall=Normal, Scenario=Normal)
- Run until Biomass % stabilises (~80–120 years)

**What to observe:**
- Stabilised Groundwater %
- Stabilised Biomass %
- Typical Fire Danger level

**Expected:** Groundwater 50–70%, Biomass ~55–65%, Fire LOW/MODERATE

**Status:** Not tested

**Results:**
- Groundwater: —
- Biomass: —
- Fire Danger: —
- Notes: —

---

## Scenario 2 — Max Rain Bias

**Targets:** W4 + W1 + W2 — soilWater must NOT pin at 100% indefinitely

**Setup:**
- Reset world
- Rainfall slider max (Wet 2×)
- Everything else default
- Run ~100 years

**What to observe:**
- Does Groundwater hit 100% and stay, or peak and stabilise lower?
- Stabilised Groundwater %
- Stabilised Biomass %
- Any visible old-growth thinning on the canvas?

**Expected:** Groundwater peaks then settles 80–92%, Biomass slightly suppressed vs Scenario 1

**Status:** Not tested

**Results:**
- Groundwater peak: —
- Groundwater stabilised: —
- Biomass: —
- Old-growth thinning visible: —
- Notes: —

---

## Scenario 3 — Drought Stress

**Targets:** Drought dieback still works; W3 transpiration accelerates collapse

**Setup (two phases):**
1. Reset world, run ~30 years at defaults to build forest
2. Then: Temp Anomaly to max (+10°C), Rainfall to minimum (Drought)

**What to observe:**
- Years until Biomass drops below 20%
- Groundwater level during collapse
- Fire Danger level during collapse

**Expected:** Rapid decline, Groundwater near 0, Fire Danger EXTREME

**Status:** Not tested

**Results:**
- Biomass at moment of drought onset: —
- Years to collapse (<20% biomass): —
- Groundwater during collapse: —
- Fire Danger: —
- Notes: —

---

## Scenario 4 — Flood Suppresses Fire

**Targets:** W5 — floodIndex zeroes fire danger during active flooding

**Setup:**
- Reset world
- Rainfall max (Wet 2×), Scenario = Pessimistic
- Run ~20 years

**What to observe:**
- Fire Danger reading — stays LOW even in summer?
- Frequency of visible fire events on canvas (should be rare despite Pessimistic)

**Expected:** Fire Danger stays LOW/MODERATE, very few fire events

**Status:** Not tested

**Results:**
- Typical Fire Danger: —
- Fire events observed: —
- Notes: —

---

## Scenario 5 — Dense vs Sparse Forest Under Drought

**Targets:** W3 transpiration — dense forest depletes soilWater faster under stress

**Run twice:**

**5a — Dense forest:**
- Reset → default settings → let Biomass reach ~60% (~60 years)
- Note Groundwater % at drought onset
- Switch to max Temp Anomaly, watch collapse speed

**5b — Sparse forest:**
- Reset → default settings → wait only 5 years (~20% biomass)
- Note Groundwater % at drought onset
- Switch to max Temp Anomaly, watch collapse speed

**What to compare:**
- Does Groundwater drop faster in 5a than 5b?
- Does 5a reach <20% Biomass sooner than 5b?

**Expected:** Dense forest (5a) collapses faster — transpiration accelerates soil depletion

**Status:** Not tested

**Results:**

| | 5a Dense | 5b Sparse |
|---|---|---|
| Biomass at drought onset | — | — |
| Groundwater at drought onset | — | — |
| Years to <20% biomass | — | — |
| Notes | — | — |

---

## Overall Assessment

- [ ] Scenario 1 passed
- [ ] Scenario 2 passed
- [ ] Scenario 3 passed
- [ ] Scenario 4 passed
- [ ] Scenario 5 passed

**Issues found during testing:**
(none yet)
