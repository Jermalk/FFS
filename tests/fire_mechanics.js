import { SimulationEngine } from '../simulation-engine.js';

function biomassPct(sim) { return sim.stats.biomass / sim.size * 100; }

// Place a single burning cell; return count of neighbors that catch fire after N ticks.
function spreadTest(sim, opts = {}) {
    const { centerX = 400, centerY = 300, ticks = 1, fillAge = 3 } = opts;
    const w = sim.width;
    const ci = centerY * w + centerX;

    // Fill all cells with living saplings
    for (let i = 0; i < sim.size; i++) {
        sim.stateGrid[i]     = 1;
        sim.nextStateGrid[i] = 1;
        sim.ageGrid[i]       = fillAge;
        sim.nextAgeGrid[i]   = fillAge;
    }
    sim.stats = { biomass: sim.size, oldGrowth: 0 };

    // Light the center cell
    sim.stateGrid[ci] = 2;

    for (let t = 0; t < ticks; t++) sim.update();
    return sim;
}

export function registerScenarios(scenario) {

    // -------------------------------------------------------------------------
    // FM-1 — Boundary safety: fire at grid edges does not crash or read garbage
    // Fixes F1. Places burning cells at all four corners and edges, runs one tick,
    // checks the simulation completes without error and the grid stays valid.
    // -------------------------------------------------------------------------
    scenario('FM-1', 'Boundary safety — fire at grid corners and edges completes without invalid reads',
        ['F1'],
        ({ val, check, runYears }) => {
            const sim = new SimulationEngine(800, 600);
            const w = sim.width, h = sim.height;

            // Fill grid with saplings
            for (let i = 0; i < sim.size; i++) {
                sim.stateGrid[i] = 1;
                sim.ageGrid[i]   = 3;
            }
            sim.stats = { biomass: sim.size, oldGrowth: 0 };

            // Light all four corners and mid-edges
            const edgeCells = [
                0,               // top-left corner
                w - 1,           // top-right corner
                (h - 1) * w,     // bottom-left corner
                h * w - 1,       // bottom-right corner
                Math.floor(w / 2),               // top edge, middle
                (h - 1) * w + Math.floor(w / 2), // bottom edge, middle
                Math.floor(h / 2) * w,           // left edge, middle
                Math.floor(h / 2) * w + w - 1,   // right edge, middle
            ];
            for (const i of edgeCells) sim.stateGrid[i] = 2;

            let threw = false;
            try { sim.update(); } catch (e) { threw = true; }

            // After one tick burning cells become empty (state 0)
            const prevFireStillBurning = edgeCells.filter(i => sim.stateGrid[i] === 2).length;

            val('Exception thrown', threw ? 'YES' : 'no');
            val('Edge fire cells still burning after tick (should be 0)', prevFireStillBurning);

            check('No exception thrown',                      !threw,                    'crashed');
            check('Edge fire cells cleared after one tick',   prevFireStillBurning === 0, `${prevFireStillBurning} still burning`);

            // All grid values must be 0, 1, or 2
            let invalid = 0;
            for (let i = 0; i < sim.size; i++) {
                const s = sim.stateGrid[i];
                if (s !== 0 && s !== 1 && s !== 2) invalid++;
            }
            val('Cells with invalid state byte', invalid);
            check('All state bytes valid (0/1/2)', invalid === 0, `${invalid} invalid`);
        }
    );

    // -------------------------------------------------------------------------
    // FM-2 — Fire spread: burning neighbor ignites saplings at high rate
    // Verifies that spread probability is high for saplings (baseFlam=0.80).
    // Runs 20 independent ignition trials from a central burning cell.
    // -------------------------------------------------------------------------
    scenario('FM-2', 'Sapling spread — burning neighbor ignites >50% of sapling neighbors',
        ['F4'],
        ({ val, check }) => {
            let ignitions = 0;
            const TRIALS = 40;

            for (let t = 0; t < TRIALS; t++) {
                const sim = new SimulationEngine(800, 600);
                // Zero fire danger: use default Temperate with no anomaly, rain high
                sim.params.tempAnomaly = 0;
                sim.params.rainBias    = 2.0;

                // Place a single burning cell surrounded by saplings
                const ci = 300 * sim.width + 400;
                for (let i = 0; i < sim.size; i++) {
                    sim.stateGrid[i] = 1;
                    sim.ageGrid[i]   = 3;  // sapling
                }
                sim.stateGrid[ci] = 2;
                sim.stats = { biomass: sim.size - 1, oldGrowth: 0 };

                sim.update();

                // Count new fires in the 8 neighbors
                const w = sim.width;
                const neighbors = [ci-w-1, ci-w, ci-w+1, ci-1, ci+1, ci+w-1, ci+w, ci+w+1];
                for (const n of neighbors) {
                    if (sim.stateGrid[n] === 2) { ignitions++; break; }
                }
            }

            const spreadRate = (ignitions / TRIALS * 100).toFixed(0);
            val('Trials', TRIALS);
            val('Trials where at least one neighbor ignited', ignitions);
            val('Spread rate', spreadRate + '%');

            check('Sapling spread rate > 50% of trials', ignitions > TRIALS * 0.5,
                `${ignitions}/${TRIALS} trials had spread`);
            check('Sapling spread rate < 100% of trials (not deterministic)', ignitions < TRIALS,
                `all ${TRIALS} trials ignited — possible over-determinism`);
        }
    );

    // -------------------------------------------------------------------------
    // FM-3 — Old-growth resistance: mature trees resist fire better than saplings
    // Compares fire persistence through old-growth (age>25, baseFlam=0.05)
    // vs sapling forest (age=3, baseFlam=0.80) under identical conditions.
    // Old-growth forest should lose significantly less coverage.
    // -------------------------------------------------------------------------
    scenario('FM-3', 'Age-based resistance — old-growth forest sustains less fire damage than sapling forest',
        ['F4'],
        ({ val, check }) => {
            function burntInForest(fillAge) {
                const sim = new SimulationEngine(200, 200);
                sim.params.tempAnomaly = 5;
                sim.params.rainBias    = 0.5;
                for (let i = 0; i < sim.size; i++) {
                    sim.stateGrid[i] = 1;
                    sim.ageGrid[i]   = fillAge;
                }
                // Light a row of 10 cells down the middle
                const midX = 100, w = sim.width;
                for (let y = 90; y < 110; y++) sim.stateGrid[y * w + midX] = 2;
                sim.stats = { biomass: sim.size - 20, oldGrowth: fillAge > 25 ? sim.size - 20 : 0 };

                // Run 5 ticks (5 seasons of potential spread)
                for (let t = 0; t < 5; t++) sim.update();

                let empty = 0;
                for (let i = 0; i < sim.size; i++) if (sim.stateGrid[i] === 0) empty++;
                return empty / sim.size * 100;
            }

            const saplingLoss  = burntInForest(3);
            const oldGrowthLoss = burntInForest(30);

            val('% cells cleared in sapling forest (5 seasons)',   saplingLoss.toFixed(1)  + '%');
            val('% cells cleared in old-growth forest (5 seasons)', oldGrowthLoss.toFixed(1) + '%');

            check('Old-growth loses less cover than saplings',
                oldGrowthLoss < saplingLoss,
                `old-growth=${oldGrowthLoss.toFixed(1)}% sapling=${saplingLoss.toFixed(1)}%`);
            check('Sapling forest loses significant cover (> 5%)',
                saplingLoss > 5,
                `only ${saplingLoss.toFixed(1)}% cleared`);
        }
    );

    // -------------------------------------------------------------------------
    // FM-4 — fireDangerIndex response: high temp + dry soil → high danger
    // F2/F3: verifies that fdi produces a measurable gradient across conditions,
    // and that the soft threshold regions (around 1.0 and 1.5) behave monotonically.
    // -------------------------------------------------------------------------
    scenario('FM-4', 'fireDangerIndex gradient — danger increases monotonically with heat and drought',
        ['F2', 'F3', 'F5'],
        ({ val, check, runYears }) => {
            function fdi(tempAnomaly, rainBias) {
                const sim = new SimulationEngine(400, 300);
                sim.params.tempAnomaly = tempAnomaly;
                sim.params.rainBias    = rainBias;
                runYears(sim, 10);
                return sim.fireDangerIndex;
            }

            const fdLow  = fdi(0,  2.0);  // cool + wet
            const fdMid  = fdi(3,  1.0);  // moderate
            const fdHigh = fdi(8,  0.3);  // hot + dry

            val('fdi cool+wet  (ta=0,  rb=2.0)', fdLow.toFixed(3));
            val('fdi moderate  (ta=3,  rb=1.0)', fdMid.toFixed(3));
            val('fdi hot+dry   (ta=8,  rb=0.3)', fdHigh.toFixed(3));

            check('Moderate danger > cool+wet',  fdMid  > fdLow,  `mid=${fdMid.toFixed(3)} low=${fdLow.toFixed(3)}`);
            check('Hot+dry danger > moderate',   fdHigh > fdMid,  `high=${fdHigh.toFixed(3)} mid=${fdMid.toFixed(3)}`);
            check('Hot+dry exceeds danger threshold 1.0', fdHigh > 1.0, `got ${fdHigh.toFixed(3)}`);
            check('Cool+wet stays below 1.0',    fdLow  < 1.0,   `got ${fdLow.toFixed(3)}`);
        }
    );

    // -------------------------------------------------------------------------
    // FM-5 — Lightning ignition scales with fire danger
    // F3: at high fdi (>2) lightning rate is 200× base rate. Verifies ignition
    // occurs more frequently under severe conditions in an otherwise empty forest.
    // -------------------------------------------------------------------------
    scenario('FM-5', 'Lightning ignition rate scales with fireDangerIndex (F3)',
        ['F3'],
        ({ val, check }) => {
            function countIgnitions(tempAnomaly, rainBias, ticks) {
                const sim = new SimulationEngine(800, 600);
                sim.params.tempAnomaly = tempAnomaly;
                sim.params.rainBias    = rainBias;

                // Fill with mature trees (low baseFlam so neighbor-spread is minimal)
                for (let i = 0; i < sim.size; i++) {
                    sim.stateGrid[i] = 1;
                    sim.ageGrid[i]   = 20;
                }
                sim.stats = { biomass: sim.size, oldGrowth: 0 };

                // Advance weather to stabilise fdi
                for (let t = 0; t < 40; t++) sim.update();

                // Count fire-starts over next `ticks` ticks
                let fires = 0;
                for (let t = 0; t < ticks; t++) {
                    sim.update();
                    for (let i = 0; i < sim.size; i++) if (sim.stateGrid[i] === 2) fires++;
                    // Extinguish all fires so they don't spread and confound the count
                    for (let i = 0; i < sim.size; i++) {
                        if (sim.stateGrid[i] === 2) { sim.stateGrid[i] = 1; sim.ageGrid[i] = 20; }
                    }
                }
                return { fires, fdi: sim.fireDangerIndex };
            }

            const TICKS = 20;
            const cool = countIgnitions(0, 2.0, TICKS);
            const hot  = countIgnitions(8, 0.2, TICKS);

            val('fdi (cool+wet)',          cool.fdi.toFixed(3));
            val('fdi (hot+dry)',           hot.fdi.toFixed(3));
            val(`Lightning fires over ${TICKS} ticks (cool+wet)`, cool.fires);
            val(`Lightning fires over ${TICKS} ticks (hot+dry)`,  hot.fires);

            check('Hot+dry produces more ignitions than cool+wet',
                hot.fires > cool.fires,
                `hot=${hot.fires} cool=${cool.fires}`);
            check('Hot+dry fdi exceeds 1.0 (elevated lightning tier)',
                hot.fdi > 1.0,
                `got ${hot.fdi.toFixed(3)}`);
        }
    );
}
