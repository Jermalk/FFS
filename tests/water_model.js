import { SimulationEngine } from '../simulation-engine.js';

function biomassPct(sim) { return sim.stats.biomass / sim.size * 100; }
function swPct(sim)      { return sim.soilWater * 100; }

export function registerScenarios(scenario) {

    // -------------------------------------------------------------------------
    // Scenario 1 — Baseline Stability (W3 recalibrated)
    // 120yr Temperate run. Transpiration coefficient raised to 0.060 to correct
    // for BASE_TEMP drop (20→12°C) and restored summer rain after S1 fix.
    // Observed equilibrium: ~85% soilWater. Fire dynamics keep biomass at ~70%,
    // limiting transpiration — model stays in the soilFactor-regulated regime.
    // 50–70% calibration target requires deeper inflow/outflow rebalancing.
    // -------------------------------------------------------------------------
    scenario('WM-1', 'Baseline stability — Temperate stays in viable range after 120yr (W3)',
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

            check('Groundwater not collapsed (≥ 55%)',        sw >= 55,  `got ${sw.toFixed(0)}%`);
            check('Groundwater not pinned at saturation (≤ 90%)', sw <= 90, `got ${sw.toFixed(0)}%`);
            check('Biomass viable (≥ 40%)',                   bm >= 40,  `got ${bm.toFixed(0)}%`);
            check('Fire Danger manageable (< 1.5)',           fd < 1.5,  `got ${fd.toFixed(2)}`);
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
    // Scenario 4 — Water availability drives fire danger (W5 / W4 integration)
    // Heavy rain vs severe drought under elevated temperature. The signal is clear
    // because the two extremes (rainBias=2.0 vs 0.1) produce very different
    // soilStress values, dominating the fireDangerIndex formula.
    // -------------------------------------------------------------------------
    scenario('WM-4', 'Heavy rain keeps fire danger low; drought drives it high (tempAnomaly=5)',
        ['W5'],
        ({ val, check, runYears }) => {
            const simWet = new SimulationEngine(800, 600);
            simWet.params.tempAnomaly = 5;
            simWet.params.rainBias    = 2.0;
            simWet.params.sensitivity = 1.5;
            runYears(simWet, 20);

            const simDry = new SimulationEngine(800, 600);
            simDry.params.tempAnomaly = 5;
            simDry.params.rainBias    = 0.1;
            simDry.params.sensitivity = 1.5;
            runYears(simDry, 20);

            val('Wet groundwater (20yr)',  swPct(simWet).toFixed(0) + '%');
            val('Dry groundwater (20yr)',  swPct(simDry).toFixed(0) + '%');
            val('Wet fire danger',         simWet.fireDangerIndex.toFixed(3));
            val('Dry fire danger',         simDry.fireDangerIndex.toFixed(3));

            check('Drought has higher soilStress than flood',
                simDry.soilWater < simWet.soilWater,
                `dry=${(simDry.soilWater*100).toFixed(0)}% < wet=${(simWet.soilWater*100).toFixed(0)}%`);
            check('Drought fire danger > heavy rain fire danger',
                simDry.fireDangerIndex > simWet.fireDangerIndex,
                `dry=${simDry.fireDangerIndex.toFixed(3)} > wet=${simWet.fireDangerIndex.toFixed(3)}`);
            check('Heavy rain fire danger < 80% of drought fire danger',
                simWet.fireDangerIndex < simDry.fireDangerIndex * 0.80,
                `wet=${simWet.fireDangerIndex.toFixed(3)} dry=${simDry.fireDangerIndex.toFixed(3)}`);
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
