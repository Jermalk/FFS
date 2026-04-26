export const ISSUES = {
    W1: { doc: 'model_water.md',          title: 'Waterlogging causes zero mortality',                          status: 'fixed' },
    W2: { doc: 'model_water.md',          title: 'pGrowth is monotonically linear — no ecological optimum',    status: 'fixed' },
    W3: { doc: 'model_water.md',          title: 'Outflow is biomass-blind (no transpiration feedback)',        status: 'fixed' },
    W4: { doc: 'model_water.md',          title: 'Runoff ignores soil saturation state (Horton flow missing)',  status: 'fixed' },
    W5: { doc: 'model_water.md',          title: 'Surplus water silently discarded (no flood signal)',          status: 'fixed' },
    S1: { doc: 'model_seasonal_logic.md', title: 'Summer rain can reach zero (rMod too extreme)',               status: 'fixed' },
    S2: { doc: 'model_seasonal_logic.md', title: 'Annual rain average is structurally below BASE_RAIN',         status: 'fixed' },
    S3: { doc: 'model_seasonal_logic.md', title: 'Annual temperature average is slightly below BASE_TEMP',      status: 'fixed' },
    S4: { doc: 'model_seasonal_logic.md', title: 'Simulation starts in Summer, not Spring',                     status: 'fixed' },
    S5: { doc: 'model_seasonal_logic.md', title: 'Growth rate is not seasonally modulated (no winter dormancy)', status: 'fixed' },
    S6: { doc: 'model_seasonal_logic.md', title: 'Single hardcoded climate; no user choice',                    status: 'fixed' },
};
