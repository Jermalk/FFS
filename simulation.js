class Ecosystem {
    constructor(canvasId, width, height) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        this.width = width;
        this.height = height;
        this.size = width * height;

        this.canvas.width = width;
        this.canvas.height = height;

        // Buffers
        this.stateGrid = new Uint8Array(this.size);
        this.nextStateGrid = new Uint8Array(this.size);
        this.ageGrid = new Uint8Array(this.size);
        this.nextAgeGrid = new Uint8Array(this.size);

        this.imageData = this.ctx.createImageData(width, height);
        this.buf32 = new Uint32Array(this.imageData.data.buffer);

        // State
        this.ticks = 0;
        this.year = 0;
        this.season = 0;
        this.soilWater = 1.0; 
        this.isPaused = false;
        
        // Flux Debug
        this.lastInflow = 0;
        this.lastOutflow = 0;

        // Constants
        this.BASE_TEMP = 20; 
        this.BASE_RAIN = 0.5;
        
        // Params
        this.params = {
            tempAnomaly: 0, 
            rainBias: 1.0, 
            speed: 60,
            sensitivity: 1.0
        };

        // Colors
        this.COLOR_EMPTY = 0xFF111111;
        this.COLOR_FIRE = 0xFF2F35FF; 
        this.COLOR_STAGE1 = 0xFF33FF8A; 
        this.COLOR_STAGE2 = 0xFF33CC33; 
        this.COLOR_STAGE3 = 0xFF339900; 
        this.COLOR_STAGE4 = 0xFF004400; 

        this.offsets = [-width-1, -width, -width+1, -1, 1, width-1, width, width+1];
        
        this.stats = { biomass: 0, oldGrowth: 0 };
        this.currentTemp = 20;
        this.currentRain = 0.5;
        this.fireDangerIndex = 0;

        this.init();
        this.loop();
    }

    init() {
        this.year = 0;
        this.ticks = 0;
        this.season = 0;
        this.soilWater = 1.0;
        let b=0, o=0;

        for (let i = 0; i < this.size; i++) {
            const r = Math.random();
            if (r < 0.45) {
                this.stateGrid[i] = 1; 
                const age = Math.floor(Math.random() * 80);
                this.ageGrid[i] = age;
                b++;
                if (age > 25) o++;
            } else {
                this.stateGrid[i] = 0;
                this.ageGrid[i] = 0;
            }
        }
        this.stats = { biomass: b, oldGrowth: o };
        this.updateWeather();
        this.draw(); 
        this.updateUI();
    }

    reset() { this.init(); }

    togglePause() {
        this.isPaused = !this.isPaused;
        const btn = document.getElementById('btn-pause');
        btn.innerText = this.isPaused ? "Resume" : "Pause";
        btn.style.background = this.isPaused ? "#4cd137" : "#e1b12c";
    }

    stepTick() { this.update(); this.draw(); this.updateUI(); }
    stepYear() { for(let i=0; i<4; i++) this.update(); this.draw(); this.updateUI(); }

    updateWeather() {
        // Seasons
        let tMod=0, rMod=0;
        if (this.season === 0) { tMod = -5; rMod = 0.2; }       
        else if (this.season === 1) { tMod = 12; rMod = -0.6; } 
        else if (this.season === 2) { tMod = 0; rMod = -0.1; }  
        else if (this.season === 3) { tMod = -10; rMod = 0.1; } 

        // 1. Calculate Base Temp
        const baseNoise = (Math.random()*2 - 1);
        this.currentTemp = this.BASE_TEMP + tMod + this.params.tempAnomaly + baseNoise;

        // 2. CLIMATE VOLATILITY 
        const volatility = 1.0 + (this.params.tempAnomaly * 0.1); 
        const rainNoise = (Math.random() * 0.4 - 0.2) * volatility; 

        // Calculate Rain
        this.currentRain = Math.max(0, Math.min(1, 
            (this.BASE_RAIN + rMod + rainNoise) * this.params.rainBias
        ));

        // --- PHYSICS V11: DECOUPLED METABOLISM ---
        const sensitivity = this.params.sensitivity;

        // A. INFLOW
        let absorptionEfficiency = 1.0;
        if (this.currentRain > 0.8) absorptionEfficiency = 0.6; // Runoff
        
        // Tuned: 0.15 is the intake rate
        const inflow = (this.currentRain * 0.15 * absorptionEfficiency); 

        // B. OUTFLOW
        // 1. Basal Metabolism: FIXED. Sensitivity does NOT affect this.
        // All forests need 0.03 water/tick to survive.
        const basalMetabolism = 0.03; 
        
        // 2. Heat Stress: DYNAMIC. Sensitivity affects this.
        // Heat multiplier (Clausius-Clapeyron approximation)
        const heatMultiplier = Math.pow(1.07, Math.max(0, this.params.tempAnomaly));
        
        // Evaporation from temperature
        // At 20C (Normal) -> (20-5)/600 = 0.025
        // Total Normal Outflow = 0.03 + 0.025 = 0.055.
        // Normal Inflow (0.5 rain) = 0.075.
        // Net = +0.02 (Healthy Surplus).
        
        const tempEvap = Math.max(0, (this.currentTemp - 5) / 600) * heatMultiplier * sensitivity;
        
        const outflow = basalMetabolism + tempEvap;

        // C. BALANCE
        this.lastInflow = inflow;
        this.lastOutflow = outflow;

        this.soilWater += (inflow - outflow);
        this.soilWater = Math.max(0, Math.min(1, this.soilWater));

        // --- FIRE DANGER ---
        let tempStress = Math.max(0, (this.currentTemp - 15) / 25); 
        let soilStress = (1.0 - this.soilWater); 
        
        this.fireDangerIndex = ((tempStress * 1.5) + (soilStress * 2.5)) * sensitivity;
    }

    update() {
        this.ticks++;
        if (this.ticks % 4 === 0) this.year++;
        this.season = this.ticks % 4;
        this.updateWeather();

        let biomass = 0;
        let oldGrowth = 0;
        const sensitivity = this.params.sensitivity;

        // Growth slows down if Sensitivity is high (fragile species grow slower in stress)
        const pGrowth = (0.008 * this.soilWater) / sensitivity; 
        
        // Lightning
        let pLightning = 0.00001; 
        if (this.fireDangerIndex > 1.0) pLightning = 0.0002; 
        if (this.fireDangerIndex > 2.0) pLightning = 0.002; 

        // Dieback logic
        // Threshold: When does the forest start dying from thirst?
        // Optimistic: Soil < 0.10
        // Pessimistic: Soil < 0.20
        let diebackThreshold = 0.13 * sensitivity;
        
        let pDieback = 0;
        if (this.soilWater < diebackThreshold) pDieback = 0.02 * sensitivity; // Slow death
        if (this.soilWater < 0.01) pDieback = 0.20 * sensitivity; // Total Collapse

        for (let i = 0; i < this.size; i++) {
            const state = this.stateGrid[i];
            const age = this.ageGrid[i];
            
            let nextState = state;
            let nextAge = age;

            if (state === 2) { 
                nextState = 0; 
                nextAge = 0;
            }
            else if (state === 0) {
                if (Math.random() < pGrowth) {
                    nextState = 1;
                    nextAge = 0;
                }
            }
            else if (state === 1) {
                biomass++;
                if (this.ticks % 4 === 0 && nextAge < 255) nextAge++;
                if (nextAge > 25) oldGrowth++;

                if (Math.random() < pDieback) {
                    nextState = 0;
                    nextAge = 0;
                } 
                else {
                    let baseFlam = 0;
                    if (age <= 5) baseFlam = 0.8;
                    else if (age <= 10) baseFlam = 0.4;
                    else if (age <= 25) baseFlam = 0.2;
                    else baseFlam = 0.05; 

                    let environmentalFlam = (this.fireDangerIndex * 0.6); 
                    if (this.fireDangerIndex > 1.5) environmentalFlam = 0.95;

                    let totalFlam = Math.min(1.0, baseFlam + environmentalFlam);

                    if (this.hasBurningNeighbor(i)) {
                        if (Math.random() < totalFlam) nextState = 2;
                    } else {
                        if (Math.random() < pLightning) nextState = 2;
                    }
                }
            }

            this.nextStateGrid[i] = nextState;
            this.nextAgeGrid[i] = nextAge;

            if (nextState === 0) this.buf32[i] = this.COLOR_EMPTY;
            else if (nextState === 2) this.buf32[i] = this.COLOR_FIRE;
            else {
                if (nextAge <= 5) this.buf32[i] = this.COLOR_STAGE1;
                else if (nextAge <= 10) this.buf32[i] = this.COLOR_STAGE2;
                else if (nextAge <= 25) this.buf32[i] = this.COLOR_STAGE3;
                else this.buf32[i] = this.COLOR_STAGE4;
            }
        }

        [this.stateGrid, this.nextStateGrid] = [this.nextStateGrid, this.stateGrid];
        [this.ageGrid, this.nextAgeGrid] = [this.nextAgeGrid, this.ageGrid];
        
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

    draw() { this.ctx.putImageData(this.imageData, 0, 0); }

    updateUI() {
        const total = this.size || 1;
        document.getElementById('ui-year').innerText = this.year;
        document.getElementById('ui-season').innerText = ['Spring','Summer','Autumn','Winter'][this.season];
        
        document.getElementById('cur-temp').innerText = this.currentTemp.toFixed(1) + "°C";
        document.getElementById('cur-rain').innerText = (this.currentRain * 100).toFixed(0) + "%";
        
        const vEl = document.getElementById('volatility-msg');
        if(this.params.tempAnomaly > 5) vEl.innerText = "⚠ Extreme Climate Instability";
        else if(this.params.tempAnomaly > 2) vEl.innerText = "High Weather Volatility";
        else vEl.innerText = "Stable Weather Pattern";

        const dEl = document.getElementById('cur-danger');
        const d = this.fireDangerIndex;
        if(d < 0.5) { dEl.innerText="LOW"; dEl.style.color="#00ff00"; }
        else if(d < 1.0) { dEl.innerText="MODERATE"; dEl.style.color="#ffff00"; }
        else if(d < 1.5) { dEl.innerText="HIGH"; dEl.style.color="#ff8800"; }
        else { dEl.innerText="EXTREME"; dEl.style.color="#ff0000"; }

        const bar = document.getElementById('soil-bar');
        const soilPct = (this.soilWater * 100).toFixed(0);
        bar.style.width = soilPct + "%";
        document.getElementById('val-soil').innerText = soilPct + "%";
        if(this.soilWater < 0.2) bar.style.background = "#d63031"; 
        else bar.style.background = "#0abde3";

        document.getElementById('flux-in').innerText = "+" + this.lastInflow.toFixed(3);
        document.getElementById('flux-out').innerText = "-" + this.lastOutflow.toFixed(3);

        document.getElementById('stat-biomass').innerText = ((this.stats.biomass/total)*100).toFixed(0)+"%";
        document.getElementById('stat-old').innerText = ((this.stats.oldGrowth/total)*100).toFixed(0)+"%";
        document.getElementById('year-overlay').innerText = `Year ${this.year}`;
    }

    loop() {
        setTimeout(() => {
            if (!this.isPaused) {
                this.update();
                this.draw();
                this.updateUI();
            }
            requestAnimationFrame(() => this.loop());
        }, 1000 / this.params.speed);
    }
}

// --- INIT ---
window.onload = function() {
    window.sim = new Ecosystem('simCanvas', 800, 600);
    
    document.getElementById('in-speed').addEventListener('input', (e) => sim.params.speed = parseInt(e.target.value));
    document.getElementById('btn-pause').addEventListener('click', () => sim.togglePause());
    document.getElementById('btn-step').addEventListener('click', () => sim.stepYear());
    document.getElementById('btn-reset').addEventListener('click', () => sim.reset());

    document.getElementById('in-scenario').addEventListener('change', (e) => {
        sim.params.sensitivity = parseFloat(e.target.value);
    });

    document.getElementById('in-temp-bias').addEventListener('input', (e) => {
        const val = parseInt(e.target.value)/10;
        sim.params.tempAnomaly = val;
        document.getElementById('val-temp-bias').innerText = "+"+val.toFixed(1)+"°C";
    });
    document.getElementById('in-rain-bias').addEventListener('input', (e) => {
        const val = parseInt(e.target.value)/10;
        sim.params.rainBias = val;
        let lbl = "Normal";
        if(val<1) lbl="Drought"; if(val>1) lbl="Wet";
        document.getElementById('val-rain-bias').innerText = `${lbl} (${val}x)`;
    });
};
