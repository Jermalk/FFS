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
        this.biomeGrid = new Uint8Array(this.size);
        this.nextBiomeGrid = new Uint8Array(this.size);

        this.imageData = this.ctx.createImageData(width, height);
        this.buf32 = new Uint32Array(this.imageData.data.buffer);

        // Constants
        this.BIOME_DESERT = 0;
        this.BIOME_STEPPE = 1;
        this.BIOME_SAVANNAH = 2;
        this.BIOME_FOREST = 3;
        this.BIOME_JUNGLE = 4;

        this.BIOME_PROPS = [
            { name: "Desert",   waterNeed: 0.01, fireResist: 0.0, growRate: 0.080, color: 0xFF0099FF, maxDensity: 0.15 }, 
            { name: "Steppe",   waterNeed: 0.20, fireResist: 0.1, growRate: 0.150, color: 0xFF00CCFF, maxDensity: 0.50 }, 
            { name: "Savannah", waterNeed: 0.40, fireResist: 0.3, growRate: 0.040, color: 0xFF99FFCC, maxDensity: 0.70 }, 
            { name: "Forest",   waterNeed: 0.65, fireResist: 0.6, growRate: 0.010, color: 0xFF00AA00, maxDensity: 0.90 }, 
            { name: "Jungle",   waterNeed: 0.85, fireResist: 0.9, growRate: 0.020, color: 0xFF663300, maxDensity: 0.99 }  
        ];
        
        this.COLOR_SOIL = 0xFF2D344A; 
        this.COLOR_ASH  = 0xFF111111; 
        this.COLOR_FIRE = 0xFF0000FF; 

        this.ticks = 0;
        this.year = 0;
        this.season = 0;
        this.soilWater = 1.0; 
        this.isPaused = false;
        this.lastInflow = 0;
        this.lastOutflow = 0;
        
        this.BASE_TEMP = 20; 
        this.BASE_RAIN = 0.5;
        this.targetBiome = 3;
        
        // V21 PARAMS: Now fully exposed to UI
        this.params = {
            tempAnomaly: 0.0, 
            rainBias: 1.0, 
            speed: 60,
            sensitivity: 1.0,
            clustering: 0.7,
            basalMetabolism: 0.025, // Exposed
            growthRate: 1.0,        // Exposed
            fireFreq: 1.0           // Exposed
        };

        this.stats = { biomes: [0,0,0,0,0], ash: 0 };
        this.offsets = [-width-1, -width, -width+1, -1, 1, width-1, width, width+1];
        
        this.init();
        this.loop();
    }

    init() {
        this.year = 0;
        this.ticks = 0;
        this.season = 0;
        this.soilWater = 1.0; 
        
        for (let i = 0; i < this.size; i++) {
            this.stateGrid[i] = 0; 
            this.ageGrid[i] = 0;
            this.biomeGrid[i] = this.BIOME_FOREST; 
            
            const r = Math.random();
            if (r < 0.75) { 
                this.stateGrid[i] = 1; 
                this.ageGrid[i] = Math.floor(Math.random() * 80);
            }
        }
        
        this.updateWeather();
        this.renderFromGrid(); 
        this.draw(); 
        this.updateUI();
    }

    reset() { this.init(); }
    togglePause() { this.isPaused = !this.isPaused; }
    stepYear() { for(let i=0; i<4; i++) this.update(); this.renderFromGrid(); this.draw(); this.updateUI(); }

    renderFromGrid() {
        let counts = [0,0,0,0,0];
        let ashCount = 0;

        for (let i = 0; i < this.size; i++) {
            const state = this.stateGrid[i];
            const biome = this.biomeGrid[i];

            if (state === 0) this.buf32[i] = this.COLOR_SOIL;
            else if (state === 3) {
                this.buf32[i] = this.COLOR_ASH;
                ashCount++;
            }
            else if (state === 2) this.buf32[i] = this.COLOR_FIRE;
            else {
                this.buf32[i] = this.BIOME_PROPS[biome].color;
                counts[biome]++;
            }
        }
        this.stats.biomes = counts;
        this.stats.ash = ashCount;
    }

    updateWeather() {
        let tMod=0, rMod=0;
        if (this.season === 0) { tMod = -5; rMod = 0.2; }       
        else if (this.season === 1) { tMod = 12; rMod = -0.6; } 
        else if (this.season === 2) { tMod = 0; rMod = -0.1; }  
        else if (this.season === 3) { tMod = -10; rMod = 0.1; } 

        const baseNoise = (Math.random()*2 - 1);
        this.currentTemp = this.BASE_TEMP + tMod + this.params.tempAnomaly + baseNoise;

        const volatility = 1.0 + (this.params.tempAnomaly * 0.1); 
        const rainNoise = (Math.random() * 0.4 - 0.2) * volatility; 
        this.currentRain = Math.max(0, Math.min(1, 
            (this.BASE_RAIN + rMod + rainNoise) * this.params.rainBias
        ));

        // --- HYDROLOGY ---
        const sensitivity = this.params.sensitivity;
        
        // 1. Inflow
        let absorptionEfficiency = 1.0;
        if (this.currentRain > 0.90) absorptionEfficiency = 0.7;
        const inflow = (this.currentRain * 0.13 * absorptionEfficiency); 

        // 2. Outflow (Uses Configured Metabolism)
        const basal = this.params.basalMetabolism; 
        
        const heatMultiplier = Math.pow(1.07, Math.max(0, this.params.tempAnomaly));
        const tempEvap = Math.max(0, (this.currentTemp - 5) / 600) * heatMultiplier * sensitivity;
        const outflow = basal + tempEvap;

        let effectiveInflow = inflow;
        if (this.params.tempAnomaly > 0) {
            effectiveInflow *= (1.0 - (this.params.tempAnomaly * 0.015)); 
        }

        this.lastInflow = effectiveInflow;
        this.lastOutflow = outflow;

        this.soilWater += (effectiveInflow - outflow);
        this.soilWater = Math.max(0, Math.min(1, this.soilWater));

        const water = this.soilWater; 
        const heat = this.BASE_TEMP + this.params.tempAnomaly;

        if (water < 0.10) this.targetBiome = this.BIOME_DESERT;
        else if (water < 0.35) this.targetBiome = this.BIOME_STEPPE;
        else if (water < 0.60) this.targetBiome = this.BIOME_SAVANNAH;
        else if (water < 0.85) this.targetBiome = this.BIOME_FOREST;
        else {
            if (heat > 25) this.targetBiome = this.BIOME_JUNGLE;
            else this.targetBiome = this.BIOME_FOREST;
        }

        let tempStress = Math.max(0, (this.currentTemp - 15) / 25); 
        let soilStress = (1.0 - this.soilWater); 
        this.fireDangerIndex = ((tempStress * 1.5) + (soilStress * 2.5)) * sensitivity;
    }

    update() {
        this.ticks++;
        if (this.ticks % 4 === 0) this.year++;
        this.season = this.ticks % 4;
        this.updateWeather();

        const sensitivity = this.params.sensitivity;
        
        // V21: Uses Fire Frequency Multiplier
        let pLightning = 0.00001 * this.params.fireFreq; 
        if (this.fireDangerIndex > 1.0) pLightning = 0.0002 * this.params.fireFreq; 
        if (this.fireDangerIndex > 2.0) pLightning = 0.002 * this.params.fireFreq; 

        let counts = [0,0,0,0,0];
        let ashCount = 0;

        for (let i = 0; i < this.size; i++) {
            const state = this.stateGrid[i];
            const age = this.ageGrid[i];
            const biome = this.biomeGrid[i];
            
            let nextState = state;
            let nextAge = age;
            let nextBiome = biome;
            const props = this.BIOME_PROPS[biome];

            if (state === 2) { 
                nextState = 3; 
                nextAge = 0;
            }
            else if (state === 3) { 
                ashCount++;
                let recoveryBase = props.growRate * 2.0; 
                let washChance = recoveryBase + (this.currentRain * 0.1);
                if (Math.random() < washChance) nextState = 0;
            }
            else if (state === 0) { 
                let spreadBiome = -1;
                if (Math.random() < this.params.clustering) {
                    const neighborIdx = i + this.offsets[Math.floor(Math.random()*8)];
                    if (neighborIdx >= 0 && neighborIdx < this.size && this.stateGrid[neighborIdx] === 1) {
                        spreadBiome = this.biomeGrid[neighborIdx];
                    }
                }

                let candidateBiome = (spreadBiome !== -1) ? spreadBiome : this.targetBiome;
                const candProps = this.BIOME_PROPS[candidateBiome];
                
                let densityCheck = Math.random() < candProps.maxDensity;
                if (candidateBiome === this.BIOME_DESERT) densityCheck = Math.random() < 0.3; 

                if (densityCheck && this.soilWater > (candProps.waterNeed - 0.05)) {
                    // V21: Uses Growth Multiplier
                    if (Math.random() < (candProps.growRate * this.params.growthRate)) {
                        nextState = 1;
                        nextAge = 0;
                        nextBiome = candidateBiome;
                    }
                }
            }
            else if (state === 1) { 
                counts[biome]++;
                if (this.ticks % 4 === 0 && nextAge < 255) nextAge++;

                let stressMalus = 0;
                if (biome !== this.targetBiome) stressMalus = 0.01 * sensitivity; 

                if (this.soilWater < props.waterNeed) {
                    const gap = props.waterNeed - this.soilWater;
                    let mortalityChance = (gap * 0.005 * sensitivity) + stressMalus;
                    
                    if (Math.random() < mortalityChance) {
                        nextState = 0;
                        nextAge = 0;
                    }
                } 
                else if (Math.random() < stressMalus) {
                     nextState = 0;
                     nextAge = 0;
                }
                else {
                    let baseFlam = 1.0 - props.fireResist; 
                    if (biome !== this.BIOME_STEPPE && age > 10) baseFlam *= 0.5;

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
            this.nextBiomeGrid[i] = nextBiome;
        }

        [this.stateGrid, this.nextStateGrid] = [this.nextStateGrid, this.stateGrid];
        [this.ageGrid, this.nextAgeGrid] = [this.nextAgeGrid, this.ageGrid];
        [this.biomeGrid, this.nextBiomeGrid] = [this.nextBiomeGrid, this.biomeGrid];
        
        this.stats.biomes = counts;
        this.stats.ash = ashCount;
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
        const elYear = document.getElementById('ui-year');
        if (elYear) elYear.innerText = this.year;
        
        const elSeason = document.getElementById('ui-season');
        if (elSeason) elSeason.innerText = ['Spring','Summer','Autumn','Winter'][this.season];
        
        const elTemp = document.getElementById('cur-temp');
        if (elTemp) elTemp.innerText = this.currentTemp.toFixed(1) + "°C";

        const elRain = document.getElementById('cur-rain');
        if (elRain) elRain.innerText = (this.currentRain * 100).toFixed(0) + "%";
        
        const names = ["DESERT", "STEPPE", "SAVANNAH", "MIXED FOREST", "JUNGLE"];
        const colors = ["#e67e22", "#f1c40f", "#badc58", "#2ecc71", "#006266"];
        
        const elTarget = document.getElementById('target-biome-label');
        if (elTarget) {
            elTarget.innerText = "CLIMATE TARGET: " + names[this.targetBiome];
            elTarget.style.color = colors[this.targetBiome];
        }

        const bar = document.getElementById('soil-bar');
        const elValSoil = document.getElementById('val-soil');
        if (bar && elValSoil) {
            const soilPct = (this.soilWater * 100).toFixed(0);
            bar.style.width = soilPct + "%";
            elValSoil.innerText = soilPct + "%";
            if(this.soilWater < 0.2) bar.style.background = "#d63031"; else bar.style.background = "#0abde3";
        }

        const elFluxIn = document.getElementById('flux-in');
        const elFluxOut = document.getElementById('flux-out');
        if (elFluxIn && elFluxOut) {
            elFluxIn.innerText = "+" + this.lastInflow.toFixed(3);
            elFluxOut.innerText = "-" + this.lastOutflow.toFixed(3);
        }

        const elOverlay = document.getElementById('year-overlay');
        if (elOverlay) elOverlay.innerText = `Year ${this.year}`;
        
        const total = this.size || 1;
        for(let i=0; i<5; i++) {
             const elPct = document.getElementById(`stat-pct-${i}`);
             const elBar = document.getElementById(`bar-${i}`);
             if(elPct && elBar) {
                 const pct = ((this.stats.biomes[i] / total) * 100).toFixed(1);
                 elPct.innerText = pct + "%";
                 elBar.style.width = pct + "%";
             }
        }
        const elAsh = document.getElementById('stat-pct-ash');
        if(elAsh) elAsh.innerText = ((this.stats.ash / total) * 100).toFixed(1) + "%";
    }

    loop() {
        setTimeout(() => {
            if (!this.isPaused) {
                this.update();
                this.renderFromGrid();
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
    
    // --- DRAWER CONTROLS ---
    document.getElementById('in-speed').addEventListener('input', (e) => sim.params.speed = parseInt(e.target.value));
    
    document.getElementById('in-clustering').addEventListener('input', (e) => {
        const val = parseInt(e.target.value)/100;
        sim.params.clustering = val;
        document.getElementById('val-cluster').innerText = val.toFixed(2);
    });

    document.getElementById('in-scenario').addEventListener('change', (e) => {
        sim.params.sensitivity = parseFloat(e.target.value);
    });

    document.getElementById('in-temp-bias').addEventListener('input', (e) => {
        // Allow float precision for 0.05 step
        const val = parseFloat(e.target.value); 
        sim.params.tempAnomaly = val;
        document.getElementById('val-temp-bias').innerText = "+"+val.toFixed(2)+"°C";
    });

    document.getElementById('in-rain-bias').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        sim.params.rainBias = val;
        let lbl = "Normal";
        if(val<1) lbl = "Drought"; if(val>1) lbl = "Wet";
        document.getElementById('val-rain-bias').innerText = `${lbl} (${val}x)`;
    });

    // New Params
    document.getElementById('in-metabolism').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        sim.params.basalMetabolism = val;
        document.getElementById('val-metabolism').innerText = val.toFixed(3);
    });

    document.getElementById('in-growth').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        sim.params.growthRate = val;
        document.getElementById('val-growth').innerText = val.toFixed(1) + "x";
    });

    document.getElementById('in-fire').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        sim.params.fireFreq = val;
        document.getElementById('val-fire').innerText = val.toFixed(1) + "x";
    });

    // --- PLAYBACK ---
    document.getElementById('btn-pause').addEventListener('click', () => sim.togglePause());
    document.getElementById('btn-step').addEventListener('click', () => sim.stepYear());
    document.getElementById('btn-reset-drawer').addEventListener('click', () => sim.reset());
};
