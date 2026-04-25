class Ecosystem {
    constructor(canvasId, width, height) {
        this.canvas = document.getElementById(canvasId);
        this.width  = width;
        this.height = height;
        this.size   = width * height;

        // Simulation buffers (CPU)
        this.stateGrid     = new Uint8Array(this.size);
        this.nextStateGrid = new Uint8Array(this.size);
        this.ageGrid       = new Uint8Array(this.size);
        this.nextAgeGrid   = new Uint8Array(this.size);

        // GPU texture data: interleaved [state, age] per cell (RG8)
        this.packedGrid = new Uint8Array(this.size * 2);

        // State
        this.ticks     = 0;
        this.year      = 0;
        this.season    = 0;
        this.soilWater = 1.0;
        this.isPaused  = false;

        // Flux
        this.lastInflow  = 0;
        this.lastOutflow = 0;

        // Constants
        this.BASE_TEMP = 20;
        this.BASE_RAIN = 0.5;

        // Params
        this.params = {
            tempAnomaly: 0,
            rainBias:    1.0,
            speed:       60,
            sensitivity: 1.0
        };

        this.offsets = [-width-1, -width, -width+1, -1, 1, width-1, width, width+1];

        this.stats          = { biomass: 0, oldGrowth: 0 };
        this.currentTemp    = 20;
        this.currentRain    = 0.5;
        this.fireDangerIndex = 0;
        this.floodIndex      = 0;

        // Loop state
        this.rafId         = null;
        this.lastTimestamp = 0;

        this.initGL();

        // Cached DOM references — avoid getElementById on every tick
        this.els = {
            year:        document.getElementById('ui-year'),
            season:      document.getElementById('ui-season'),
            temp:        document.getElementById('cur-temp'),
            rain:        document.getElementById('cur-rain'),
            volatility:  document.getElementById('volatility-msg'),
            danger:      document.getElementById('cur-danger'),
            soilBar:     document.getElementById('soil-bar'),
            soilVal:     document.getElementById('val-soil'),
            fluxIn:      document.getElementById('flux-in'),
            fluxOut:     document.getElementById('flux-out'),
            biomass:     document.getElementById('stat-biomass'),
            oldGrowth:   document.getElementById('stat-old'),
            yearOverlay: document.getElementById('year-overlay'),
            btnPause:    document.getElementById('btn-pause'),
        };

        this.init();
        this.loop();
    }

    initGL() {
        const gl = this.canvas.getContext('webgl2');
        if (!gl) throw new Error('WebGL2 not supported');
        this.gl = gl;

        // --- Shaders ---
        // Fullscreen quad via gl_VertexID — no vertex buffer needed.
        // UV Y is flipped so row 0 of simulation data appears at the top of the screen
        // (WebGL texImage2D places row 0 at texture V=0 which is the bottom without flip).
        const vsSource = `#version 300 es
            const vec2 pos[4] = vec2[](vec2(-1,-1), vec2(1,-1), vec2(-1,1), vec2(1,1));
            const vec2 uv[4]  = vec2[](vec2(0,1),   vec2(1,1),  vec2(0,0),  vec2(1,0));
            out vec2 vUV;
            void main() {
                vUV = uv[gl_VertexID];
                gl_Position = vec4(pos[gl_VertexID], 0.0, 1.0);
            }`;

        // R channel = cell state (0=empty, 1=tree, 2=fire), G channel = tree age.
        // Multiply by 255 to recover integer values from normalised RG8 texture.
        const fsSource = `#version 300 es
            precision mediump float;
            uniform sampler2D uGrid;
            in vec2 vUV;
            out vec4 fragColor;
            void main() {
                vec2 raw  = texture(uGrid, vUV).rg * 255.0;
                int state = int(raw.r + 0.5);
                int age   = int(raw.g + 0.5);
                if      (state == 0)  fragColor = vec4(0.067, 0.067, 0.067, 1.0); // empty
                else if (state == 2)  fragColor = vec4(1.000, 0.208, 0.184, 1.0); // fire
                else if (age  <=  5)  fragColor = vec4(0.541, 1.000, 0.200, 1.0); // sapling
                else if (age  <= 10)  fragColor = vec4(0.200, 0.800, 0.200, 1.0); // young
                else if (age  <= 25)  fragColor = vec4(0.000, 0.600, 0.200, 1.0); // mature
                else                  fragColor = vec4(0.000, 0.267, 0.000, 1.0); // old growth
            }`;

        const compile = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
                throw new Error('Shader compile error: ' + gl.getShaderInfoLog(s));
            return s;
        };

        const prog = gl.createProgram();
        gl.attachShader(prog, compile(gl.VERTEX_SHADER,   vsSource));
        gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSource));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
            throw new Error('Program link error: ' + gl.getProgramInfoLog(prog));
        gl.useProgram(prog);

        // --- Texture: RG8, one texel per simulation cell ---
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, this.width, this.height, 0,
                      gl.RG, gl.UNSIGNED_BYTE, null);
        this.glTex = tex;
        gl.uniform1i(gl.getUniformLocation(prog, 'uGrid'), 0);

        // Empty VAO required by WebGL2 spec even with no vertex attributes
        this.glVAO = gl.createVertexArray();
        gl.bindVertexArray(this.glVAO);

        // Background clear colour matches page background (#0d0d0d ≈ 0.051)
        gl.clearColor(0.051, 0.051, 0.051, 1.0);

        // --- Viewport resize handler ---
        // Letterboxes the 800×600 simulation inside whatever space the canvas occupies.
        const resize = () => {
            const w = this.canvas.clientWidth;
            const h = this.canvas.clientHeight;
            this.canvas.width  = w;
            this.canvas.height = h;

            const simAspect  = this.width / this.height;   // 800/600 = 4/3
            const viewAspect = w / h;
            let vx, vy, vw, vh;
            if (viewAspect > simAspect) {
                // Wider than 4:3 → pillarbox
                vh = h;  vw = Math.round(h * simAspect);
                vy = 0;  vx = Math.round((w - vw) / 2);
            } else {
                // Taller than 4:3 → letterbox
                vw = w;  vh = Math.round(w / simAspect);
                vx = 0;  vy = Math.round((h - vh) / 2);
            }
            this.glViewport = { vx, vy, vw, vh };
            gl.viewport(vx, vy, vw, vh);
        };
        window.addEventListener('resize', resize);
        resize();
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
                this.ageGrid[i] = age;
                b++;
                if (age > 25) o++;
            } else {
                this.stateGrid[i] = 0;
                this.ageGrid[i]   = 0;
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
        this.els.btnPause.innerText        = this.isPaused ? "Resume" : "Pause";
        this.els.btnPause.style.background = this.isPaused ? "#4cd137" : "#e1b12c";
        if (this.isPaused) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        } else {
            this.lastTimestamp = 0;
            this.rafId = requestAnimationFrame((ts) => this.loop(ts));
        }
    }

    stepTick() { this.update(); this.draw(); this.updateUI(); }
    stepYear()  { for (let i = 0; i < 4; i++) this.update(); this.draw(); this.updateUI(); }

    updateWeather() {
        // Seasons
        let tMod = 0, rMod = 0;
        if      (this.season === 0) { tMod =  -5; rMod =  0.2; }
        else if (this.season === 1) { tMod =  12; rMod = -0.6; }
        else if (this.season === 2) { tMod =   0; rMod = -0.1; }
        else if (this.season === 3) { tMod = -10; rMod =  0.1; }

        // 1. Temperature with seasonal noise
        const baseNoise = (Math.random() * 2 - 1);
        this.currentTemp = this.BASE_TEMP + tMod + this.params.tempAnomaly + baseNoise;

        // 2. CLIMATE VOLATILITY — higher anomaly → more erratic rainfall
        const volatility = 1.0 + (this.params.tempAnomaly * 0.1);
        const rainNoise  = (Math.random() * 0.4 - 0.2) * volatility;

        this.currentRain = Math.max(0, Math.min(1,
            (this.BASE_RAIN + rMod + rainNoise) * this.params.rainBias
        ));

        // --- PHYSICS: DECOUPLED METABOLISM ---
        const sensitivity = this.params.sensitivity;

        // A. INFLOW — Horton overland flow (W4)
        // Infiltration degrades with both rain intensity AND soil saturation.
        // Dry soil absorbs heavy rain; saturated soil rejects even light rain.
        const rainFactor = this.currentRain > 0.6
            ? 1 - ((this.currentRain - 0.6) / 0.4) * 0.5   // 1.0 → 0.5 as rain 0.6→1.0
            : 1.0;
        const soilFactor = this.soilWater > 0.8
            ? 1 - ((this.soilWater - 0.8) / 0.2) * 0.8     // 1.0 → 0.2 as soilWater 0.8→1.0
            : 1.0;
        const absorptionEfficiency = rainFactor * soilFactor;
        const inflow = this.currentRain * 0.15 * absorptionEfficiency;

        // B. OUTFLOW
        // Basal metabolism: FIXED — sensitivity does NOT affect this.
        // All forests need 0.03 water/tick to survive.
        const basalMetabolism = 0.03;

        // Heat stress via Clausius-Clapeyron approximation — sensitivity scales this.
        const heatMultiplier = Math.pow(1.07, Math.max(0, this.params.tempAnomaly));
        const tempEvap       = Math.max(0, (this.currentTemp - 5) / 600) * heatMultiplier * sensitivity;

        // Transpiration: biomass-driven outflow (W3).
        // Dense canopy pulls far more water than bare ground — creates self-regulating feedback.
        // Uses previous tick's biomass count (one-tick lag: updateWeather runs before update).
        // Coefficient 0.012 chosen for ~58% biomass equilibrium at normal conditions after W4.
        const biomassFraction  = this.stats.biomass / this.size;
        const transpirationRate = 0.012 * biomassFraction * Math.max(0, this.currentTemp / 20) * sensitivity;

        const outflow = basalMetabolism + tempEvap + transpirationRate;

        // C. BALANCE
        this.lastInflow  = inflow;
        this.lastOutflow = outflow;
        this.soilWater  += (inflow - outflow);

        // Compute overflow BEFORE clamping — captures surface ponding signal (W5).
        // floodIndex 0→1 over 0.05 units of overflow (small overflow = full surface flood).
        const overflow   = Math.max(0, this.soilWater - 1.0);
        this.floodIndex  = Math.min(1, overflow * 20);
        this.soilWater   = Math.max(0, Math.min(1, this.soilWater));

        // --- FIRE DANGER ---
        const tempStress = Math.max(0, (this.currentTemp - 15) / 25);
        const soilStress = 1.0 - this.soilWater;
        this.fireDangerIndex = ((tempStress * 1.5) + (soilStress * 2.5)) * sensitivity;
        // Surface flooding suppresses ignition — water on ground blocks fire spread (W5)
        this.fireDangerIndex *= Math.max(0, 1 - this.floodIndex);
    }

    update() {
        this.ticks++;
        if (this.ticks % 4 === 0) this.year++;
        this.season = this.ticks % 4;
        this.updateWeather();

        let biomass = 0, oldGrowth = 0;
        const sensitivity = this.params.sensitivity;

        // Growth rate peaks at optimal soil moisture (~70%) and falls off on both sides (W2).
        // Below optimal: linear rise. Above optimal: quadratic suppression to 40% at soilWater=1.
        const OPTIMAL_MOISTURE = 0.70;
        let moistureFactor;
        if (this.soilWater <= OPTIMAL_MOISTURE) {
            moistureFactor = this.soilWater / OPTIMAL_MOISTURE;
        } else {
            const excess = (this.soilWater - OPTIMAL_MOISTURE) / (1 - OPTIMAL_MOISTURE);
            moistureFactor = 1 - (excess * excess * 0.6);
        }
        const pGrowth = 0.008 * moistureFactor / sensitivity;

        // Lightning ignition rate scales with fire danger
        let pLightning = 0.00001;
        if (this.fireDangerIndex > 1.0) pLightning = 0.0002;
        if (this.fireDangerIndex > 2.0) pLightning = 0.002;

        // Drought dieback — Optimistic threshold < 0.091, Normal < 0.13, Pessimistic < 0.195
        let diebackThreshold = 0.13 * sensitivity;
        let pDieback = 0;
        if (this.soilWater < diebackThreshold) pDieback = 0.02 * sensitivity; // Slow death
        if (this.soilWater < 0.01)             pDieback = 0.20 * sensitivity; // Total collapse

        // Waterlogging dieback (W1) — mirrors drought logic on the upper moisture end.
        // Saturated soil blocks oxygen from roots (anaerobic stress / root asphyxiation).
        // Old-growth trees (age > 25) get 1.5× multiplier: deeper roots, deeper anaerobic zone.
        let pWaterlog = 0;
        if (this.soilWater > 0.92) pWaterlog = 0.01 * sensitivity; // Slow suffocation
        if (this.soilWater > 0.98) pWaterlog = 0.08 * sensitivity; // Acute flooding
        // Active surface flooding amplifies root mortality beyond saturation alone (W5)
        pWaterlog += this.floodIndex * 0.04 * sensitivity;

        for (let i = 0; i < this.size; i++) {
            const state = this.stateGrid[i];
            const age   = this.ageGrid[i];
            let nextState = state;
            let nextAge   = age;

            if (state === 2) {
                // Fire burns for one tick then clears
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
                    // Flammability decreases as trees mature
                    let baseFlam = 0;
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

    draw() {
        const gl = this.gl;
        const { vx, vy, vw, vh } = this.glViewport;

        // Pack state and age into interleaved RG8 buffer for GPU upload
        for (let i = 0; i < this.size; i++) {
            this.packedGrid[i * 2]     = this.stateGrid[i];
            this.packedGrid[i * 2 + 1] = this.ageGrid[i];
        }

        // Clear the full canvas (covers letterbox bars too), then restore simulation viewport
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.viewport(vx, vy, vw, vh);

        gl.bindTexture(gl.TEXTURE_2D, this.glTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height,
                         gl.RG, gl.UNSIGNED_BYTE, this.packedGrid);
        gl.bindVertexArray(this.glVAO);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    updateUI() {
        const total = this.size || 1;
        const e = this.els;

        e.year.innerText   = this.year;
        e.season.innerText = ['Spring', 'Summer', 'Autumn', 'Winter'][this.season];
        e.temp.innerText   = this.currentTemp.toFixed(1) + "°C";
        e.rain.innerText   = (this.currentRain * 100).toFixed(0) + "%";

        if      (this.params.tempAnomaly > 5) e.volatility.innerText = "⚠ Extreme Climate Instability";
        else if (this.params.tempAnomaly > 2) e.volatility.innerText = "High Weather Volatility";
        else                                  e.volatility.innerText = "Stable Weather Pattern";

        const d = this.fireDangerIndex;
        if      (d < 0.5) { e.danger.innerText = "LOW";      e.danger.style.color = "#00ff00"; }
        else if (d < 1.0) { e.danger.innerText = "MODERATE"; e.danger.style.color = "#ffff00"; }
        else if (d < 1.5) { e.danger.innerText = "HIGH";     e.danger.style.color = "#ff8800"; }
        else              { e.danger.innerText = "EXTREME";   e.danger.style.color = "#ff0000"; }

        const soilPct = (this.soilWater * 100).toFixed(0);
        e.soilBar.style.width      = soilPct + "%";
        e.soilVal.innerText        = soilPct + "%";
        e.soilBar.style.background = this.soilWater < 0.2 ? "#d63031" : "#0abde3";

        e.fluxIn.innerText    = "+" + this.lastInflow.toFixed(3);
        e.fluxOut.innerText   = "-" + this.lastOutflow.toFixed(3);
        e.biomass.innerText   = ((this.stats.biomass   / total) * 100).toFixed(0) + "%";
        e.oldGrowth.innerText = ((this.stats.oldGrowth / total) * 100).toFixed(0) + "%";
        e.yearOverlay.innerText = `Year ${this.year}`;
    }

    loop(timestamp = 0) {
        const elapsed  = timestamp - this.lastTimestamp;
        const interval = 1000 / this.params.speed;

        if (elapsed >= interval) {
            this.lastTimestamp = timestamp - (elapsed % interval);
            this.update();
            this.draw();
            this.updateUI();
        }

        this.rafId = requestAnimationFrame((ts) => this.loop(ts));
    }
}

// --- INIT ---
window.onload = function () {
    window.sim = new Ecosystem('simCanvas', 800, 600);

    document.getElementById('in-speed').addEventListener('input', (e) =>
        sim.params.speed = parseInt(e.target.value));
    document.getElementById('btn-pause').addEventListener('click', () => sim.togglePause());
    document.getElementById('btn-step').addEventListener('click',  () => sim.stepYear());
    document.getElementById('btn-reset').addEventListener('click', () => sim.reset());

    document.getElementById('in-scenario').addEventListener('change', (e) =>
        sim.params.sensitivity = parseFloat(e.target.value));

    document.getElementById('in-temp-bias').addEventListener('input', (e) => {
        const val = parseInt(e.target.value) / 10;
        sim.params.tempAnomaly = val;
        document.getElementById('val-temp-bias').innerText = "+" + val.toFixed(1) + "°C";
    });
    document.getElementById('in-rain-bias').addEventListener('input', (e) => {
        const val = parseInt(e.target.value) / 10;
        sim.params.rainBias = val;
        let lbl = "Normal";
        if (val < 1) lbl = "Drought";
        if (val > 1) lbl = "Wet";
        document.getElementById('val-rain-bias').innerText = `${lbl} (${val}x)`;
    });
};
