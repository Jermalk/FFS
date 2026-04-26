import { SimulationEngine } from '../simulation-engine.js';

function biomassPct(sim) { return sim.stats.biomass / sim.size * 100; }
function swPct(sim)      { return sim.soilWater * 100; }

export function registerScenarios(scenario) {

    // -------------------------------------------------------------------------
    // Scenario 1 — Baseline Calibration (W3 equilibrium)
    // -------------------------------------------------------------------------
    scenario('WM-1', 'Baseline calibration (120 years, defaults)',
        ['W3'],
        ({ val, check, runYears }) => {
            const sim = new SimulationEngine(800, 600);
            runYears(sim, 120);

            const sw = swPct(sim);
            const bm = biomassPct(sim);
            const fd = sim.fireDangerIndex;

            val('Groundwater',  sw.toFixed(0) + '%');
            val('Biomass',      bm.toFixed(0) + '%');
            val('Fire Danger',  fd.toFixed(2));

            check('Groundwater 45–75%', sw >= 45 && sw <= 75, `got ${sw.toFixed(0)}%`);
            check('Biomass 45–70%',     bm >= 45 && bm <= 70, `got ${bm.toFixed(0)}%`);
            check('Fire Danger < 1.5',  fd < 1.5,              `got ${fd.toFixed(2)}`);
        }
    );

    // -------------------------------------------------------------------------
    // Scenario 2 — Max Rain Bias (W4 + W1 + W2)
    // -------------------------------------------------------------------------
    scenario('WM-2', 'Max rain bias — soilWater must not pin at 100% (100 years, rainBias=2.0)',
        ['W1', 'W2', 'W4'],
        ({ val, check, runYears }) => {
            const sim = new SimulationEngine(800, 600);
            sim.params.rainBias = 2.0;
            runYears(sim, 100);

            const sw = swPct(sim);
            const bm = biomassPct(sim);

            val('Groundwater (stabilised)', sw.toFixed(0) + '%');
            val('Biomass',                  bm.toFixed(0) + '%');

            check('Groundwater not pinned at 100% (< 98%)', sw < 98, `got ${sw.toFixed(0)}%`);
            check('Groundwater not collapsed (> 40%)',       sw > 40, `got ${sw.toFixed(0)}%`);
            check('Biomass exists (> 20%)',                  bm > 20, `got ${bm.toFixed(0)}%`);
        }
    );

    // -------------------------------------------------------------------------
    // Scenario 3 — Drought Stress (W3 transpiration accelerates collapse)
    // -------------------------------------------------------------------------
    scenario('WM-3', 'Drought stress — 30yr build then 30yr max drought',
        ['W3'],
        ({ val, check, runYears }) => {
            const sim = new SimulationEngine(800, 600);
            runYears(sim, 30);

            val('Biomass at drought onset',  biomassPct(sim).toFixed(0) + '%');
            val('Groundwater at onset',      swPct(sim).toFixed(0) + '%');

            sim.params.tempAnomaly = 10;
            sim.params.rainBias    = 0.1;
            runYears(sim, 30);

            const swFinal = swPct(sim);
            const bmFinal = biomassPct(sim);
            const fd      = sim.fireDangerIndex;

            val('Groundwater after 30yr drought', swFinal.toFixed(0) + '%');
            val('Biomass after 30yr drought',     bmFinal.toFixed(0) + '%');
            val('Fire Danger',                    fd.toFixed(2));

            check('Biomass collapses to < 30%',   bmFinal < 30, `got ${bmFinal.toFixed(0)}%`);
            check('Groundwater depleted (< 25%)', swFinal < 25, `got ${swFinal.toFixed(0)}%`);
            check('Fire Danger elevated (> 1.0)', fd > 1.0,     `got ${fd.toFixed(2)}`);
        }
    );

    // -------------------------------------------------------------------------
    // Scenario 4 — Flood Suppresses Fire (W5 floodIndex)
    // -------------------------------------------------------------------------
    scenario('WM-4', 'Max rain suppresses fire (20 years, rainBias=2.0, pessimistic)',
        ['W5'],
        ({ val, check, runYears }) => {
            const sim = new SimulationEngine(800, 600);
            sim.params.rainBias    = 2.0;
            sim.params.sensitivity = 1.5;
            runYears(sim, 19);
            let fdSum = 0;
            for (let i = 0; i < 4; i++) { sim.update(); fdSum += sim.fireDangerIndex; }
            const fdAvg = fdSum / 4;

            const simDry = new SimulationEngine(800, 600);
            simDry.params.sensitivity = 1.5;
            runYears(simDry, 19);
            let fdDrySum = 0;
            for (let i = 0; i < 4; i++) { simDry.update(); fdDrySum += simDry.fireDangerIndex; }
            const fdDryAvg = fdDrySum / 4;

            val('Groundwater',                                  swPct(sim).toFixed(0) + '%');
            val('Avg Fire Danger (heavy rain)',                  fdAvg.toFixed(3));
            val('Avg Fire Danger (normal rain, for comparison)', fdDryAvg.toFixed(3));

            check('High rain lowers fire danger vs normal rain',
                fdAvg < fdDryAvg, `wet=${fdAvg.toFixed(3)} vs normal=${fdDryAvg.toFixed(3)}`);
            check('Fire Danger not EXTREME under heavy rain (< 1.5)',
                fdAvg < 1.5, `got ${fdAvg.toFixed(3)}`);
        }
    );

    // -------------------------------------------------------------------------
    // Scenario 5 — Dense vs Sparse Forest Under Drought (W3 transpiration)
    // -------------------------------------------------------------------------
    scenario('WM-5', 'Dense vs sparse forest under drought — transpiration feedback (W3)',
        ['W3'],
        ({ val, check, runYears }) => {
            const sim5a = new SimulationEngine(800, 600);
            runYears(sim5a, 60);
            const sw5a_start = sim5a.soilWater;

            const sim5b = new SimulationEngine(800, 600);
            runYears(sim5b, 5);
            const sw5b_start = sim5b.soilWater;

            val('Dense biomass at drought onset',  biomassPct(sim5a).toFixed(0) + '%');
            val('Sparse biomass at drought onset', biomassPct(sim5b).toFixed(0) + '%');
            val('Dense groundwater at onset',      (sw5a_start*100).toFixed(0) + '%');
            val('Sparse groundwater at onset',     (sw5b_start*100).toFixed(0) + '%');

            sim5a.params.tempAnomaly = 6;
            sim5a.params.rainBias    = 0.2;
            sim5b.params.tempAnomaly = 6;
            sim5b.params.rainBias    = 0.2;

            let out5a = 0, out5b = 0;
            for (let i = 0; i < 4; i++) {
                sim5a.update(); out5a += sim5a.lastOutflow;
                sim5b.update(); out5b += sim5b.lastOutflow;
            }
            runYears(sim5a, 4);
            runYears(sim5b, 4);
            const sw5a_end = swPct(sim5a);
            const sw5b_end = swPct(sim5b);

            val('Dense outflow (yr 1 of drought)',       out5a.toFixed(4));
            val('Sparse outflow (yr 1 of drought)',      out5b.toFixed(4));
            val('Dense groundwater after 5yr drought',  sw5a_end.toFixed(0) + '%');
            val('Sparse groundwater after 5yr drought', sw5b_end.toFixed(0) + '%');

            check('Dense forest has higher water outflow than sparse (transpiration)',
                out5a > out5b, `dense=${out5a.toFixed(4)} sparse=${out5b.toFixed(4)}`);
            check('Dense forest more depleted after 5yr drought',
                sw5a_end <= sw5b_end, `dense=${sw5a_end.toFixed(0)}% sparse=${sw5b_end.toFixed(0)}%`);
        }
    );
}
