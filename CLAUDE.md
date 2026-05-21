# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Simulation

Open `index.htm` directly in a browser — no build step, no server required. The simulation runs as a self-contained HTML + vanilla JS application.

## Running Tests

Tests use ES modules and must be served over HTTP (not `file://`):

```
python3 -m http.server 8080
```

Then open:
- `localhost:8080/test/` — hub listing all suites
- `localhost:8080/test/water/` — Water Model (WM-1 to WM-5)
- `localhost:8080/test/fire/` — Fire Mechanics (FM-1 to FM-5)
- `localhost:8080/test/seasons/` — Seasonal Logic (SL-1 to SL-6)
- `localhost:8080/test/sensitivity/` — Sensitivity Parameter (SS-1 to SS-4)

## Architecture

The project is two files:

- **`index.htm`** — layout, all CSS, and UI controls (sliders, buttons, dropdowns). References `simulation.js` via a `<script>` tag.
- **`simulation.js`** — the entire simulation logic as a single `Ecosystem` class, instantiated on `window.onload` as `window.sim`.

### Ecosystem Class (`simulation.js`)

The simulation uses a **cellular automaton** on an 800×600 grid rendered to a `<canvas>` element via raw pixel buffer (`Uint32Array` over `ImageData`).

**Cell states** (stored in `Uint8Array stateGrid`):
- `0` — Empty/bare ground
- `1` — Living tree (age tracked in `ageGrid`)
- `2` — On fire (burns for one tick, then becomes empty)

**Tree age stages** (visual only, affects flammability):
- Age 0–5: Sapling (high flammability 0.8)
- Age 6–10: Young (flammability 0.4)
- Age 11–25: Mature (flammability 0.2)
- Age 25+: Old growth (low flammability 0.05)

**Simulation loop** (`loop()` → `update()` → `draw()` → `updateUI()`):
- Uses `setTimeout` + `requestAnimationFrame` for speed control
- Each `update()` call = 1 season (quarter-year); every 4 ticks = 1 year
- Double-buffering: `stateGrid`/`nextStateGrid` and `ageGrid`/`nextAgeGrid` are swapped each tick

**Water/climate model** (`updateWeather()`):
- `soilWater` (0–1) is updated each tick via inflow (rain × absorption rate) minus outflow (basal metabolism + heat evaporation)
- Temperature anomaly drives rainfall volatility and a `fireDangerIndex`
- `sensitivity` parameter (0.7 / 1.0 / 1.5) scales heat stress and dieback thresholds

**Key parameters** (`this.params`):
- `tempAnomaly` — additional °C above baseline (0–10, from slider 0–100 divided by 10)
- `rainBias` — rainfall multiplier (0–2, from slider 0–20 divided by 10)
- `speed` — ticks per second (1–60)
- `sensitivity` — model scenario (Optimistic/Normal/Pessimistic)

**Fire spread**: each burning cell (`state === 2`) is cleared next tick; neighbors ignite based on `totalFlam = baseFlam + environmentalFlam`, checked via `hasBurningNeighbor()` which reads 8 surrounding offsets. Lightning strikes trigger spontaneous ignition at rate `pLightning` (scales with fire danger index).

## Workflow

- **Each logical change gets its own commit.** Keep commits small and focused so individual changes can be reviewed and reverted independently. Run commits automatically — do not ask the user to do it manually.
- **After each commit, update `ENGINE_COMMIT`** in `simulation.js` to the short hash of that commit (`git rev-parse --short HEAD`), then include the update in the next commit. This keeps save files traceable to the exact engine state that produced them.
- **Update `PROGRESS.md`** at the end of each session — note what was validated, what was changed, and any new findings.
- **Update `PROGRESS.md` before context compaction.** If the conversation is approaching context limits (compaction imminent), write and commit a `PROGRESS.md` update immediately, before the compaction occurs.
- **Update `README.md`** at the end of each session to reflect any new features, controls, test coverage, or status changes. README is the human-facing document for users without LLM support — keep it accurate and complete.
- **Commit message format:** short imperative subject line describing *what and why* (e.g. `fix: clamp hasBurningNeighbor to grid bounds`).

## `#session-wrap` command

When the user types `#session-wrap`, perform all end-of-session housekeeping in this order:

1. **Update `PROGRESS.md`** — add a new session block: what was built, what was validated, what failed, what is known-pending. Include any calibration observations or design decisions made.
2. **Update `README.md`** — reflect any new features, controls, test results, or status changes visible to a human user.
3. **Commit both files** with message `docs: session wrap — <one-line summary>`.
4. Report back: what was written, what the next session should pick up first.
