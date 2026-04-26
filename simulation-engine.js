// simulation-engine.js — pure simulation engine, no DOM / WebGL dependencies
// Runs identically in a browser (via <script type="module">) and in Node.js.

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

        this.BASE_TEMP = 20;
        this.BASE_RAIN = 0.5;

        this.params = {
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
        this.ticks     = 0;
        this.season    = 0;
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
        let tMod = 0, rMod = 0;
        if      (this.season === 0) { tMod =  -5; rMod =  0.30; }
        else if (this.season === 1) { tMod =  12; rMod = -0.45; }
        else if (this.season === 2) { tMod =   0; rMod = -0.05; }
        else if (this.season === 3) { tMod = -10; rMod =  0.20; }

        const baseNoise = (Math.random() * 2 - 1);
        this.currentTemp = this.BASE_TEMP + tMod + this.params.tempAnomaly + baseNoise;

        const volatility = 1.0 + (this.params.tempAnomaly * 0.1);
        const rainNoise  = (Math.random() * 0.4 - 0.2) * volatility;
        this.currentRain = Math.max(0, Math.min(1,
            (this.BASE_RAIN + rMod + rainNoise) * this.params.rainBias
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
        const transpirationRate = 0.012 * biomassFraction * Math.max(0, this.currentTemp / 20) * sensitivity;

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
        const pGrowth = 0.008 * moistureFactor * this.params.growthRate / sensitivity;

        let pLightning = 0.00001 * this.params.fireFreq;
        if (this.fireDangerIndex > 1.0) pLightning = 0.0002 * this.params.fireFreq;
        if (this.fireDangerIndex > 2.0) pLightning = 0.002  * this.params.fireFreq;

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

                    let environmentalFlam = this.fireDangerIndex * 0.6;
                    if (this.fireDangerIndex > 1.5) environmentalFlam = 0.95;

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

    hasBurningNeighbor(i) {
        if (this.stateGrid[i + this.offsets[0]] === 2) return true;
        if (this.stateGrid[i + this.offsets[1]] === 2) return true;
        if (this.stateGrid[i + this.offsets[2]] === 2) return true;
        if (this.stateGrid[i + this.offsets[3]] === 2) return true;
        if (this.stateGrid[i + this.offsets[4]] === 2) return true;
        if (this.stateGrid[i + this.offsets[5]] === 2) return true;
        if (this.stateGrid[i + this.offsets[6]] === 2) return true;
        if (this.stateGrid[i + this.offsets[7]] === 2) return true;
        return false;
    }
}
