// simulation-engine.js — pure simulation engine, no DOM / WebGL dependencies
// Runs identically in a browser (via <script type="module">) and in Node.js.

// Seasonal modifiers must sum to 0 per preset so BASE_TEMP/BASE_RAIN are true annual means.
export const CLIMATE_PRESETS = {
    temperate: {
        label: 'Temperate',
        BASE_TEMP: 12, BASE_RAIN: 0.55,
        seasons: [
            { tMod:  +3, rMod: +0.09 },  // Spring
            { tMod: +10, rMod: +0.01 },  // Summer
            { tMod:  +2, rMod: +0.05 },  // Autumn
            { tMod: -15, rMod: -0.15 },  // Winter
        ]
    },
    mediterranean: {
        label: 'Mediterranean',
        BASE_TEMP: 18, BASE_RAIN: 0.40,
        seasons: [
            { tMod:  -5, rMod: +0.15 },  // Spring
            { tMod: +12, rMod: -0.35 },  // Summer
            { tMod:  +1, rMod: +0.10 },  // Autumn
            { tMod:  -8, rMod: +0.10 },  // Winter
        ]
    },
    tropical: {
        label: 'Tropical (Wet/Dry)',
        BASE_TEMP: 27, BASE_RAIN: 0.60,
        seasons: [
            { tMod:  +1, rMod: -0.25 },  // Dry onset
            { tMod:  +3, rMod: -0.40 },  // Peak dry
            { tMod:   0, rMod: +0.30 },  // Wet onset
            { tMod:  -4, rMod: +0.35 },  // Peak wet
        ]
    },
    boreal: {
        label: 'Boreal',
        BASE_TEMP: 4, BASE_RAIN: 0.45,
        seasons: [
            { tMod:  +6, rMod: +0.05 },  // Spring
            { tMod: +16, rMod: +0.04 },  // Summer
            { tMod:  +4, rMod: +0.01 },  // Autumn
            { tMod: -26, rMod: -0.10 },  // Winter
        ]
    },
    semiarid: {
        label: 'Semi-Arid',
        BASE_TEMP: 22, BASE_RAIN: 0.28,
        seasons: [
            { tMod:  +3, rMod: +0.07 },  // Spring
            { tMod: +10, rMod: -0.15 },  // Summer
            { tMod:  +2, rMod: +0.05 },  // Autumn
            { tMod: -15, rMod: +0.03 },  // Winter
        ]
    },
};

export class SimulationEngine {
    constructor(width, height) {
        this.width  = width;
        this.height = height;
        this.size   = width * height;

        this.stateGrid     = new Uint8Array(this.size);
        this.nextStateGrid = new Uint8Array(this.size);
        this.ageGrid       = new Uint8Array(this.size);
        this.nextAgeGrid   = new Uint8Array(this.size);

        this.ticks    = 0;
        this.year     = 0;
        this.season   = 0;
        this.soilWater = 1.0;
        this.floodIndex = 0;

        this.lastInflow  = 0;
        this.lastOutflow = 0;

        this.params = {
            climateType:     'temperate',
            tempAnomaly:     0,
            rainBias:        1.0,
            speed:           60,
            sensitivity:     1.0,
            basalMetabolism: 0.03,
            growthRate:      1.0,
            fireFreq:        1.0
        };

        this.offsets = [-width-1, -width, -width+1, -1, 1, width-1, width, width+1];

        this.stats           = { biomass: 0, oldGrowth: 0 };
        this.currentTemp     = 20;
        this.currentRain     = 0.5;
        this.fireDangerIndex = 0;

        this.init();
    }

    init() {
        this.year      = 0;
        this.ticks     = 3;   // first update() → ticks=4 → season=0 (Spring), year=1
        this.season    = 3;
        this.soilWater = 1.0;
        let b = 0, o = 0;

        for (let i = 0; i < this.size; i++) {
            const r = Math.random();
            if (r < 0.45) {
                this.stateGrid[i] = 1;
                const age = Math.floor(Math.random() * 80);
                this.ageGrid[i]   = age;
                b++;
                if (age > 25) o++;
            } else {
                this.stateGrid[i] = 0;
                this.ageGrid[i]   = 0;
            }
        }
        this.stats = { biomass: b, oldGrowth: o };
        this.updateWeather();
    }

    reset() { this.init(); }

    updateWeather() {
        const preset = CLIMATE_PRESETS[this.params.climateType];
        const { tMod, rMod } = preset.seasons[this.season];
        const BASE_TEMP = preset.BASE_TEMP;
        const BASE_RAIN = preset.BASE_RAIN;

        const baseNoise = (Math.random() * 2 - 1);
        this.currentTemp = BASE_TEMP + tMod + this.params.tempAnomaly + baseNoise;

        const volatility = 1.0 + (this.params.tempAnomaly * 0.1);
        const rainNoise  = (Math.random() * 0.4 - 0.2) * volatility;
        this.currentRain = Math.max(0, Math.min(1,
            (BASE_RAIN + rMod + rainNoise) * this.params.rainBias
        ));

        const sensitivity = this.params.sensitivity;

        // Inflow — Horton overland flow (W4)
        const rainFactor = this.currentRain > 0.6
            ? 1 - ((this.currentRain - 0.6) / 0.4) * 0.5
            : 1.0;
        const soilFactor = this.soilWater > 0.8
            ? 1 - ((this.soilWater - 0.8) / 0.2) * 0.8
            : 1.0;
        const inflow = this.currentRain * 0.15 * rainFactor * soilFactor;

        // Outflow
        const basalMetabolism = this.params.basalMetabolism;
        const heatMultiplier  = Math.pow(1.07, Math.max(0, this.params.tempAnomaly));
        const tempEvap        = Math.max(0, (this.currentTemp - 5) / 600) * heatMultiplier * sensitivity;

        // Transpiration scales with biomass (W3)
        const biomassFraction   = this.stats.biomass / this.size;
        const transpirationRate = 0.060 * biomassFraction * Math.max(0, this.currentTemp / 20) * sensitivity;

        const outflow = basalMetabolism + tempEvap + transpirationRate;

        this.lastInflow  = inflow;
        this.lastOutflow = outflow;
        this.soilWater  += (inflow - outflow);

        // Overflow before clamp → flood signal (W5)
        const overflow  = Math.max(0, this.soilWater - 1.0);
        this.floodIndex = Math.min(1, overflow * 20);
        this.soilWater  = Math.max(0, Math.min(1, this.soilWater));

        const tempStress = Math.max(0, (this.currentTemp - 15) / 25);
        const soilStress = 1.0 - this.soilWater;
        this.fireDangerIndex  = ((tempStress * 1.5) + (soilStress * 2.5)) * sensitivity;
        this.fireDangerIndex *= Math.max(0, 1 - this.floodIndex);
    }

    update() {
        this.ticks++;
        if (this.ticks % 4 === 0) this.year++;
        this.season = this.ticks % 4;
        this.updateWeather();

        let biomass = 0, oldGrowth = 0;
        const sensitivity = this.params.sensitivity;

        // Growth bell-curve peaking at 70% soil moisture (W2)
        const OPTIMAL = 0.70;
        let moistureFactor;
        if (this.soilWater <= OPTIMAL) {
            moistureFactor = this.soilWater / OPTIMAL;
        } else {
            const excess = (this.soilWater - OPTIMAL) / (1 - OPTIMAL);
            moistureFactor = 1 - (excess * excess * 0.6);
        }
        // Winter dormancy (S5): growth suppressed below 20°C, zero at ≤5°C
        const growthTempFactor = Math.max(0, Math.min(1, (this.currentTemp - 5) / 15));
        const pGrowth = 0.008 * moistureFactor * growthTempFactor * this.params.growthRate / sensitivity;

        const pLightning = 0.00001 * Math.pow(10, Math.min(this.fireDangerIndex, 3)) * this.params.fireFreq;

        // Drought dieback
        let pDieback = 0;
        if (this.soilWater < 0.13 * sensitivity) pDieback = 0.02 * sensitivity;
        if (this.soilWater < 0.01)               pDieback = 0.20 * sensitivity;

        // Waterlogging dieback — root asphyxiation (W1)
        let pWaterlog = 0;
        if (this.soilWater > 0.92) pWaterlog = 0.01 * sensitivity;
        if (this.soilWater > 0.98) pWaterlog = 0.08 * sensitivity;
        pWaterlog += this.floodIndex * 0.04 * sensitivity;

        for (let i = 0; i < this.size; i++) {
            const state = this.stateGrid[i];
            const age   = this.ageGrid[i];
            let nextState = state;
            let nextAge   = age;

            if (state === 2) {
                nextState = 0;
                nextAge   = 0;
            } else if (state === 0) {
                if (Math.random() < pGrowth) { nextState = 1; nextAge = 0; }
            } else if (state === 1) {
                biomass++;
                if (this.ticks % 4 === 0 && nextAge < 255) nextAge++;
                if (nextAge > 25) oldGrowth++;

                const effectivePWaterlog = nextAge > 25 ? pWaterlog * 1.5 : pWaterlog;
                if (Math.random() < pDieback || Math.random() < effectivePWaterlog) {
                    nextState = 0;
                    nextAge   = 0;
                } else {
                    let baseFlam;
                    if      (age <=  5) baseFlam = 0.80;
                    else if (age <= 10) baseFlam = 0.40;
                    else if (age <= 25) baseFlam = 0.20;
                    else                baseFlam = 0.05;

                    const environmentalFlam = Math.min(0.80, this.fireDangerIndex * 0.4);

                    const totalFlam = Math.min(1.0, baseFlam + environmentalFlam);

                    if (this.hasBurningNeighbor(i)) {
                        if (Math.random() < totalFlam) nextState = 2;
                    } else {
                        if (Math.random() < pLightning) nextState = 2;
                    }
                }
            }

            this.nextStateGrid[i] = nextState;
            this.nextAgeGrid[i]   = nextAge;
        }

        [this.stateGrid, this.nextStateGrid] = [this.nextStateGrid, this.stateGrid];
        [this.ageGrid,   this.nextAgeGrid]   = [this.nextAgeGrid,   this.ageGrid];

        this.stats = { biomass, oldGrowth };
    }

    setClimate(type) {
        if (!CLIMATE_PRESETS[type]) return;
        this.params.climateType = type;
        this.reset();
    }

    hasBurningNeighbor(i) {
        const w  = this.width;
        const x  = i % w;
        const y  = (i / w) | 0;
        const x0 = x > 0, x1 = x < w - 1;
        const y0 = y > 0, y1 = y < this.height - 1;
        if (y0) {
            if (x0 && this.stateGrid[i - w - 1] === 2) return true;
            if (       this.stateGrid[i - w    ] === 2) return true;
            if (x1 && this.stateGrid[i - w + 1] === 2) return true;
        }
        if (x0 && this.stateGrid[i - 1] === 2) return true;
        if (x1 && this.stateGrid[i + 1] === 2) return true;
        if (y1) {
            if (x0 && this.stateGrid[i + w - 1] === 2) return true;
            if (       this.stateGrid[i + w    ] === 2) return true;
            if (x1 && this.stateGrid[i + w + 1] === 2) return true;
        }
        return false;
    }
}
