# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Simulation

Open `index.htm` directly in a browser — no build step, no server required. The simulation runs as a self-contained HTML + vanilla JS application.

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

- **Each logical change gets its own commit.** Keep commits small and focused so individual changes can be reviewed and reverted independently.
- **Update `PROGRESS.md`** at the end of each session — note what was validated, what was changed, and any new findings.
- **Commit message format:** short imperative subject line describing *what and why* (e.g. `fix: clamp hasBurningNeighbor to grid bounds`).
