import { SimulationEngine } from '../simulation-engine.js';

export function registerScenarios(scenario) {

    // -------------------------------------------------------------------------
    // FM-1 — Boundary safety: fire at grid edges does not crash or produce invalid state
    // Fixes F1. Places burning cells at all four corners and mid-edges, runs one tick.
    // -------------------------------------------------------------------------
    scenario('FM-1', 'Boundary safety — fire at grid corners and edges completes without invalid reads',
        ['F1'],
        ({ val, check }) => {
            const sim = new SimulationEngine(800, 600);
            const w = sim.width, h = sim.height;
            for (let i = 0; i < sim.size; i++) { sim.stateGrid[i] = 1; sim.ageGrid[i] = 3; }
            sim.stats = { biomass: sim.size, oldGrowth: 0 };

            const edgeCells = [
                0, w - 1, (h - 1) * w, h * w - 1,
                Math.floor(w / 2),
                (h - 1) * w + Math.floor(w / 2),
                Math.floor(h / 2) * w,
                Math.floor(h / 2) * w + w - 1,
            ];
            for (const i of edgeCells) sim.stateGrid[i] = 2;

            let threw = false;
            try { sim.update(); } catch (e) { threw = true; }

            const stillBurning = edgeCells.filter(i => sim.stateGrid[i] === 2).length;
            let invalid = 0;
            for (let i = 0; i < sim.size; i++) {
                const s = sim.stateGrid[i];
                if (s !== 0 && s !== 1 && s !== 2) invalid++;
            }

            val('Exception thrown',                          threw ? 'YES' : 'no');
            val('Edge cells still burning after tick',       stillBurning);
            val('Cells with invalid state byte',             invalid);

            check('No exception thrown',                     !threw,                    'crashed');
            check('Edge fire cells cleared after one tick',  stillBurning === 0,        `${stillBurning} still burning`);
            check('All state bytes valid (0/1/2)',           invalid === 0,             `${invalid} invalid`);
        }
    );

    // -------------------------------------------------------------------------
    // FM-2 — Sapling flammability: most (>60%) of the 8 neighbors of a burning
    // sapling-age tree ignite in one tick under zero fire danger.
    // baseFlam=0.80 means each neighbor independently has 80% chance.
    // Expected fraction: ~80%. We check the average across 20 trials.
    // -------------------------------------------------------------------------
    scenario('FM-2', 'Sapling spread rate — ~80% of sapling neighbors ignite from a burning cell',
        ['F4'],
        ({ val, check }) => {
            const TRIALS = 20;
            let totalNeighborsIgnited = 0;
            const NEIGHBORS = 8;

            for (let t = 0; t < TRIALS; t++) {
                const sim = new SimulationEngine(800, 600);
                sim.params.tempAnomaly = 0;
                sim.params.rainBias    = 2.0;  // wet — keeps fdi near 0

                const ci = 300 * sim.width + 400;
                for (let i = 0; i < sim.size; i++) { sim.stateGrid[i] = 1; sim.ageGrid[i] = 3; }
                sim.stateGrid[ci] = 2;
                sim.stats = { biomass: sim.size - 1, oldGrowth: 0 };

                sim.update();

                const ww = sim.width;
                const nb = [ci-ww-1, ci-ww, ci-ww+1, ci-1, ci+1, ci+ww-1, ci+ww, ci+ww+1];
                totalNeighborsIgnited += nb.filter(n => sim.stateGrid[n] === 2).length;
            }

            const avgIgnited   = totalNeighborsIgnited / TRIALS;
            const avgRate      = (avgIgnited / NEIGHBORS * 100).toFixed(0);

            val('Trials',                          TRIALS);
            val('Average neighbors ignited / trial', avgIgnited.toFixed(1) + ' of ' + NEIGHBORS);
            val('Average ignition rate',            avgRate + '%');

            check('Average ignition rate > 60%',   avgIgnited / NEIGHBORS > 0.60,
                `got ${avgRate}%`);
            check('Average ignition rate < 100%',  avgIgnited / NEIGHBORS < 1.00,
                `deterministic — no stochasticity`);
        }
    );

    // -------------------------------------------------------------------------
    // FM-3 — Age-based resistance: old-growth resists fire better than saplings.
    // Uses a 100×100 grid, 15-cell ignition line, 15 ticks of spread.
    // Old-growth (baseFlam=0.05) should lose significantly less cover than
    // saplings (baseFlam=0.80).
    // Conditions: ta=0, rainBias=2.0 — keeps soilWater stable (soilStress stays
    // near 0, pLightning < 1/tick) so the test isolates neighbour-spread age
    // resistance and is not swamped by drought-driven lightning ignitions.
    // -------------------------------------------------------------------------
    scenario('FM-3', 'Age-based resistance — old-growth forest sustains less fire damage than saplings',
        ['F4'],
        ({ val, check }) => {
            function burntInForest(fillAge) {
                const sim = new SimulationEngine(100, 100);
                sim.params.tempAnomaly = 0;
                sim.params.rainBias    = 2.0;
                for (let i = 0; i < sim.size; i++) {
                    sim.stateGrid[i] = 1;
                    sim.ageGrid[i]   = fillAge;
                }
                const w = sim.width;
                // Light a horizontal band of 15 cells near the top
                for (let x = 42; x < 57; x++) sim.stateGrid[20 * w + x] = 2;
                sim.stats = { biomass: sim.size - 15, oldGrowth: fillAge > 25 ? sim.size - 15 : 0 };

                for (let t = 0; t < 15; t++) sim.update();

                let empty = 0;
                for (let i = 0; i < sim.size; i++) if (sim.stateGrid[i] === 0) empty++;
                return empty / sim.size * 100;
            }

            const saplingLoss   = burntInForest(3);
            const oldGrowthLoss = burntInForest(30);

            val('% cleared in sapling forest (15 seasons)',   saplingLoss.toFixed(1)   + '%');
            val('% cleared in old-growth forest (15 seasons)', oldGrowthLoss.toFixed(1) + '%');

            check('Old-growth loses less cover than saplings',
                oldGrowthLoss < saplingLoss,
                `old-growth=${oldGrowthLoss.toFixed(1)}% sapling=${saplingLoss.toFixed(1)}%`);
            check('Sapling forest loses > 2% cover (fire spreads noticeably)',
                saplingLoss > 2,
                `only ${saplingLoss.toFixed(1)}% cleared`);
        }
    );

    // -------------------------------------------------------------------------
    // FM-4 — fireDangerIndex gradient: danger increases with heat and drought.
    // Uses 200-tick (50-year) runs so soilWater and fdi stabilise.
    // Three conditions: cool+wet, hot+dry, extreme.
    // -------------------------------------------------------------------------
    scenario('FM-4', 'fireDangerIndex gradient — increases monotonically with heat and drought',
        ['F2', 'F3', 'F5'],
        ({ val, check }) => {
            function stableFdi(tempAnomaly, rainBias) {
                const sim = new SimulationEngine(400, 300);
                sim.params.tempAnomaly = tempAnomaly;
                sim.params.rainBias    = rainBias;
                // Run 50 years; average fdi over last 20 ticks for stability
                for (let i = 0; i < 180; i++) sim.update();
                let sum = 0;
                for (let i = 0; i < 20; i++) { sim.update(); sum += sim.fireDangerIndex; }
                return sum / 20;
            }

            const fdLow  = stableFdi(0,  2.0);  // cool + wet
            const fdMid  = stableFdi(5,  0.8);  // warm + mild drought
            const fdHigh = stableFdi(8,  0.2);  // hot + severe drought

            val('fdi cool+wet   (ta=0, rb=2.0)', fdLow.toFixed(3));
            val('fdi warm+mild  (ta=5, rb=0.8)', fdMid.toFixed(3));
            val('fdi hot+dry    (ta=8, rb=0.2)', fdHigh.toFixed(3));

            check('Warm+mild danger > cool+wet',  fdMid  > fdLow,  `mid=${fdMid.toFixed(3)} low=${fdLow.toFixed(3)}`);
            check('Hot+dry danger > warm+mild',   fdHigh > fdMid,  `high=${fdHigh.toFixed(3)} mid=${fdMid.toFixed(3)}`);
            check('Hot+dry exceeds threshold 1.0', fdHigh > 1.0,   `got ${fdHigh.toFixed(3)}`);
            check('Cool+wet stays below 1.0',     fdLow  < 1.0,   `got ${fdLow.toFixed(3)}`);
        }
    );

    // -------------------------------------------------------------------------
    // FM-5 — Lightning ignition scales with fireDangerIndex (F3).
    // Keeps the forest alive by refilling trees before each measurement tick.
    // Compares ignition counts at low fdi vs high fdi.
    // -------------------------------------------------------------------------
    scenario('FM-5', 'Lightning ignition rate scales with fireDangerIndex',
        ['F3'],
        ({ val, check }) => {
            function measureLightning(tempAnomaly, rainBias, measureTicks) {
                const sim = new SimulationEngine(800, 600);
                sim.params.tempAnomaly = tempAnomaly;
                sim.params.rainBias    = rainBias;

                // Stabilise weather only — manually advance weather without tree updates
                // by calling updateWeather directly (it's a method on the engine)
                // Instead: run update() but re-fill grid each tick to prevent die-off
                for (let i = 0; i < sim.size; i++) { sim.stateGrid[i] = 1; sim.ageGrid[i] = 20; }
                sim.stats = { biomass: sim.size, oldGrowth: 0 };

                // Warm up 40 ticks, refilling after each to keep forest alive
                for (let t = 0; t < 40; t++) {
                    sim.update();
                    for (let i = 0; i < sim.size; i++) {
                        if (sim.stateGrid[i] !== 1) { sim.stateGrid[i] = 1; sim.ageGrid[i] = 20; }
                    }
                    sim.stats = { biomass: sim.size, oldGrowth: 0 };
                }

                const stabilisedFdi = sim.fireDangerIndex;
                let fires = 0;

                for (let t = 0; t < measureTicks; t++) {
                    // Ensure full forest before each tick
                    for (let i = 0; i < sim.size; i++) { sim.stateGrid[i] = 1; sim.ageGrid[i] = 20; }
                    sim.stats = { biomass: sim.size, oldGrowth: 0 };

                    sim.update();
                    for (let i = 0; i < sim.size; i++) if (sim.stateGrid[i] === 2) fires++;
                }
                return { fires, fdi: stabilisedFdi };
            }

            const TICKS = 20;
            const cool  = measureLightning(0, 2.0, TICKS);
            const hot   = measureLightning(8, 0.2, TICKS);

            val('fdi (cool+wet)',                            cool.fdi.toFixed(3));
            val('fdi (hot+dry)',                             hot.fdi.toFixed(3));
            val(`Lightning ignitions over ${TICKS} ticks (cool+wet)`, cool.fires);
            val(`Lightning ignitions over ${TICKS} ticks (hot+dry)`,  hot.fires);

            check('Hot+dry fdi > 1.0 (elevated lightning tier)',
                hot.fdi > 1.0,
                `got ${hot.fdi.toFixed(3)}`);
            check('Hot+dry ignitions > cool+wet ignitions',
                hot.fires > cool.fires,
                `hot=${hot.fires} cool=${cool.fires}`);
        }
    );
}
