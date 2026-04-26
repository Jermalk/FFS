import { SimulationEngine } from '../simulation-engine.js';

function biomassPct(sim) { return sim.stats.biomass / sim.size * 100; }

export function registerScenarios(scenario) {

    // -------------------------------------------------------------------------
    // SS-1 — Biomass equilibrium ordering under neutral conditions
    // 100yr Temperate run with no anomaly. Pessimistic drains soil faster
    // (more evap + transpiration) and grows slower (pGrowth ÷ sensitivity),
    // so it should equilibrate at lower biomass than Optimistic.
    // -------------------------------------------------------------------------
    scenario('SS-1', 'Biomass equilibrium ordering — Optimistic > Pessimistic after 100yr neutral climate',
        ['SP1'],
        ({ val, check, runYears }) => {
            const simOpt  = new SimulationEngine(800, 600);
            const simPess = new SimulationEngine(800, 600);
            simOpt.params.sensitivity  = 0.7;
            simPess.params.sensitivity = 1.5;

            runYears(simOpt,  100);
            runYears(simPess, 100);

            const bmOpt  = biomassPct(simOpt);
            const bmPess = biomassPct(simPess);
            const diff   = bmOpt - bmPess;

            val('Optimistic biomass (100yr)',  bmOpt.toFixed(0) + '%');
            val('Pessimistic biomass (100yr)', bmPess.toFixed(0) + '%');
            val('Difference (Opt − Pess)',     diff.toFixed(0) + ' ppt');

            check('Optimistic biomass > Pessimistic (ordering)',
                bmOpt > bmPess,
                `Opt=${bmOpt.toFixed(0)}% Pess=${bmPess.toFixed(0)}%`);
            check('Difference ≥ 8 ppt (ecologically meaningful)',
                diff >= 8,
                `diff=${diff.toFixed(0)} ppt`);
        }
    );

    // -------------------------------------------------------------------------
    // SS-2 — Fire danger gradient across all three sensitivity levels
    // 50yr run under mild stress (ta=3, rb=0.7). fireDangerIndex is scaled
    // directly by sensitivity, amplified by the soil-stress term it also drives.
    // Expected ordering: Pess > Normal > Opt.
    // -------------------------------------------------------------------------
    scenario('SS-2', 'Fire danger ordering — Pessimistic > Normal > Optimistic under mild stress (ta=3, rb=0.7)',
        ['SP2'],
        ({ val, check, runYears }) => {
            const simOpt  = new SimulationEngine(800, 600);
            const simNorm = new SimulationEngine(800, 600);
            const simPess = new SimulationEngine(800, 600);

            for (const sim of [simOpt, simNorm, simPess]) {
                sim.params.tempAnomaly = 3;
                sim.params.rainBias    = 0.7;
            }
            simOpt.params.sensitivity  = 0.7;
            simPess.params.sensitivity = 1.5;

            runYears(simOpt,  50);
            runYears(simNorm, 50);
            runYears(simPess, 50);

            const fdiOpt  = simOpt.fireDangerIndex;
            const fdiNorm = simNorm.fireDangerIndex;
            const fdiPess = simPess.fireDangerIndex;
            const ratio   = fdiPess / Math.max(fdiOpt, 0.001);

            val('Optimistic FDI (50yr)',   fdiOpt.toFixed(3));
            val('Normal FDI (50yr)',       fdiNorm.toFixed(3));
            val('Pessimistic FDI (50yr)',  fdiPess.toFixed(3));
            val('Ratio (Pess / Opt)',      ratio.toFixed(2) + '×');

            check('Pessimistic FDI > Normal FDI (ordering)',
                fdiPess > fdiNorm,
                `Pess=${fdiPess.toFixed(3)} Normal=${fdiNorm.toFixed(3)}`);
            check('Normal FDI > Optimistic FDI (ordering)',
                fdiNorm > fdiOpt,
                `Normal=${fdiNorm.toFixed(3)} Opt=${fdiOpt.toFixed(3)}`);
            check('Pessimistic FDI ≥ 1.4× Optimistic (meaningful gradient)',
                ratio >= 1.4,
                `ratio=${ratio.toFixed(2)}`);
        }
    );

    // -------------------------------------------------------------------------
    // SS-3 — Growth recovery speed from empty grid
    // Clears all trees, resets soilWater to 0.70 (optimal moisture), then runs
    // 20yr. Only pGrowth (÷ sensitivity) and pDieback (× sensitivity) differ.
    // Isolates the growth-rate signal cleanly from soil-water feedback.
    // Expected ordering: Opt > Normal > Pess.
    // -------------------------------------------------------------------------
    scenario('SS-3', 'Growth recovery speed — Optimistic colonises faster from empty grid than Pessimistic (20yr)',
        ['SP3'],
        ({ val, check, runYears, clearGrid }) => {
            const simOpt  = new SimulationEngine(800, 600);
            const simNorm = new SimulationEngine(800, 600);
            const simPess = new SimulationEngine(800, 600);

            simOpt.params.sensitivity  = 0.7;
            simPess.params.sensitivity = 1.5;

            for (const sim of [simOpt, simNorm, simPess]) {
                clearGrid(sim);
                sim.soilWater = 0.70;
            }

            runYears(simOpt,  20);
            runYears(simNorm, 20);
            runYears(simPess, 20);

            const bmOpt  = biomassPct(simOpt);
            const bmNorm = biomassPct(simNorm);
            const bmPess = biomassPct(simPess);
            const ratio  = bmOpt / Math.max(bmPess, 0.1);

            val('Optimistic biomass (20yr from empty)',  bmOpt.toFixed(0) + '%');
            val('Normal biomass (20yr from empty)',      bmNorm.toFixed(0) + '%');
            val('Pessimistic biomass (20yr from empty)', bmPess.toFixed(0) + '%');
            val('Ratio (Opt / Pess)',                    ratio.toFixed(2) + '×');

            check('Optimistic biomass > Normal (ordering)',
                bmOpt > bmNorm,
                `Opt=${bmOpt.toFixed(0)}% Normal=${bmNorm.toFixed(0)}%`);
            check('Normal biomass > Pessimistic (ordering)',
                bmNorm > bmPess,
                `Normal=${bmNorm.toFixed(0)}% Pess=${bmPess.toFixed(0)}%`);
            check('Optimistic biomass ≥ 1.3× Pessimistic (meaningful speed difference)',
                ratio >= 1.3,
                `ratio=${ratio.toFixed(2)}`);
        }
    );

    // -------------------------------------------------------------------------
    // SS-4 — Long-run resilience under moderate climate stress
    // 80yr run at ta=4, rb=0.7. All three sensitivity levels. Under sustained
    // mild stress, Pessimistic's higher evaporation, weaker growth, and stronger
    // fire response should produce a clearly lower equilibrium biomass.
    // -------------------------------------------------------------------------
    scenario('SS-4', 'Stress resilience ordering — Optimistic > Normal > Pessimistic under 80yr moderate stress (ta=4, rb=0.7)',
        ['SP4'],
        ({ val, check, runYears }) => {
            const simOpt  = new SimulationEngine(800, 600);
            const simNorm = new SimulationEngine(800, 600);
            const simPess = new SimulationEngine(800, 600);

            for (const sim of [simOpt, simNorm, simPess]) {
                sim.params.tempAnomaly = 4;
                sim.params.rainBias    = 0.7;
            }
            simOpt.params.sensitivity  = 0.7;
            simPess.params.sensitivity = 1.5;

            runYears(simOpt,  80);
            runYears(simNorm, 80);
            runYears(simPess, 80);

            const bmOpt  = biomassPct(simOpt);
            const bmNorm = biomassPct(simNorm);
            const bmPess = biomassPct(simPess);
            const swOpt  = simOpt.soilWater * 100;
            const swPess = simPess.soilWater * 100;
            const diff   = bmOpt - bmPess;

            val('Optimistic biomass (80yr)',  bmOpt.toFixed(0) + '%');
            val('Normal biomass (80yr)',      bmNorm.toFixed(0) + '%');
            val('Pessimistic biomass (80yr)', bmPess.toFixed(0) + '%');
            val('Optimistic soilWater',       swOpt.toFixed(0) + '%');
            val('Pessimistic soilWater',      swPess.toFixed(0) + '%');
            val('Biomass difference (Opt − Pess)', diff.toFixed(0) + ' ppt');

            check('Optimistic biomass > Pessimistic (ordering)',
                bmOpt > bmPess,
                `Opt=${bmOpt.toFixed(0)}% Pess=${bmPess.toFixed(0)}%`);
            check('Normal biomass between Opt and Pess',
                bmOpt >= bmNorm && bmNorm >= bmPess,
                `Opt=${bmOpt.toFixed(0)}% Normal=${bmNorm.toFixed(0)}% Pess=${bmPess.toFixed(0)}%`);
            check('Optimistic soilWater > Pessimistic soilWater',
                swOpt > swPess,
                `Opt=${swOpt.toFixed(0)}% Pess=${swPess.toFixed(0)}%`);
            check('Biomass difference ≥ 8 ppt',
                diff >= 8,
                `diff=${diff.toFixed(0)} ppt`);
        }
    );
}
