// simulation.js — browser wiring: WebGL renderer + UI + loop
// Pure simulation logic lives in simulation-engine.js.

import { SimulationEngine } from './simulation-engine.js';

// ---- WebGL Renderer --------------------------------------------------------

function initGL(canvas, simWidth, simHeight) {
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not supported');

    const vsSource = `#version 300 es
        const vec2 pos[4] = vec2[](vec2(-1,-1), vec2(1,-1), vec2(-1,1), vec2(1,1));
        const vec2 uv[4]  = vec2[](vec2(0,1),   vec2(1,1),  vec2(0,0),  vec2(1,0));
        out vec2 vUV;
        void main() {
            vUV = uv[gl_VertexID];
            gl_Position = vec4(pos[gl_VertexID], 0.0, 1.0);
        }`;

    // R = cell state (0=empty, 1=tree, 2=fire), G = tree age (both ×255 normalised)
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
            throw new Error('Shader error: ' + gl.getShaderInfoLog(s));
        return s;
    };

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER,   vsSource));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
        throw new Error('Program link error: ' + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, simWidth, simHeight, 0,
                  gl.RG, gl.UNSIGNED_BYTE, null);
    gl.uniform1i(gl.getUniformLocation(prog, 'uGrid'), 0);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    gl.clearColor(0.051, 0.051, 0.051, 1.0);

    const packedGrid = new Uint8Array(simWidth * simHeight * 2);

    // Letterbox the 800×600 simulation inside whatever space the canvas occupies
    const glState = { gl, tex, vao, packedGrid, viewport: { vx:0, vy:0, vw:simWidth, vh:simHeight } };

    function resize() {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        canvas.width  = w;
        canvas.height = h;

        const simAspect  = simWidth / simHeight;
        const viewAspect = w / h;
        let vx, vy, vw, vh;
        if (viewAspect > simAspect) {
            vh = h;  vw = Math.round(h * simAspect);
            vy = 0;  vx = Math.round((w - vw) / 2);
        } else {
            vw = w;  vh = Math.round(w / simAspect);
            vx = 0;  vy = Math.round((h - vh) / 2);
        }
        glState.viewport = { vx, vy, vw, vh };
        gl.viewport(vx, vy, vw, vh);
    }
    window.addEventListener('resize', resize);
    resize();

    return glState;
}

function draw(glState, engine) {
    const { gl, tex, vao, packedGrid } = glState;
    const { vx, vy, vw, vh } = glState.viewport;

    for (let i = 0; i < engine.size; i++) {
        packedGrid[i * 2]     = engine.stateGrid[i];
        packedGrid[i * 2 + 1] = engine.ageGrid[i];
    }

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(vx, vy, vw, vh);

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, engine.width, engine.height,
                     gl.RG, gl.UNSIGNED_BYTE, packedGrid);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// ---- UI update -------------------------------------------------------------

function updateUI(els, engine) {
    const total = engine.size;

    els.year.innerText   = engine.year;
    els.season.innerText = ['Spring', 'Summer', 'Autumn', 'Winter'][engine.season];
    els.temp.innerText   = engine.currentTemp.toFixed(1) + "°C";
    els.rain.innerText   = (engine.currentRain * 100).toFixed(0) + "%";

    if      (engine.params.tempAnomaly > 5) els.volatility.innerText = "⚠ Extreme Climate Instability";
    else if (engine.params.tempAnomaly > 2) els.volatility.innerText = "High Weather Volatility";
    else                                    els.volatility.innerText = "Stable Weather Pattern";

    const d = engine.fireDangerIndex;
    if      (d < 0.5) { els.danger.innerText = "LOW";      els.danger.style.color = "#00ff00"; }
    else if (d < 1.0) { els.danger.innerText = "MODERATE"; els.danger.style.color = "#ffff00"; }
    else if (d < 1.5) { els.danger.innerText = "HIGH";     els.danger.style.color = "#ff8800"; }
    else              { els.danger.innerText = "EXTREME";   els.danger.style.color = "#ff0000"; }

    const soilPct = (engine.soilWater * 100).toFixed(0);
    els.soilBar.style.width      = soilPct + "%";
    els.soilVal.innerText        = soilPct + "%";
    els.soilBar.style.background = engine.soilWater < 0.2 ? "#d63031" : "#0abde3";

    els.fluxIn.innerText    = "+" + engine.lastInflow.toFixed(3);
    els.fluxOut.innerText   = "-" + engine.lastOutflow.toFixed(3);
    els.biomass.innerText   = ((engine.stats.biomass   / total) * 100).toFixed(0) + "%";
    els.oldGrowth.innerText = ((engine.stats.oldGrowth / total) * 100).toFixed(0) + "%";
    els.yearOverlay.innerText = `Year ${engine.year}`;
}

// ---- App -------------------------------------------------------------------

window.onload = function () {
    const engine  = new SimulationEngine(800, 600);
    const canvas  = document.getElementById('simCanvas');
    const glState = initGL(canvas, 800, 600);

    const els = {
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
        fps:         document.getElementById('stat-fps'),
        simspeed:    document.getElementById('stat-simspeed'),
    };

    let isPaused = false;
    let rafId    = null;
    let lastTimestamp = 0;

    // Performance counters — sampled once per second
    let frameCount = 0, tickCount = 0, lastSample = 0;

    function loop(timestamp = 0) {
        // Render every frame — decoupled from sim speed
        draw(glState, engine);
        frameCount++;

        // Sample FPS and sim speed once per second
        if (timestamp - lastSample >= 1000) {
            const yrs = tickCount / 4;
            els.fps.innerText      = frameCount + ' fps';
            els.simspeed.innerText = (yrs >= 1 ? yrs.toFixed(0) : yrs.toFixed(1)) + ' yr/s';
            frameCount = 0;
            tickCount  = 0;
            lastSample = timestamp;
        }

        // Advance simulation at the user-configured rate
        const elapsed  = timestamp - lastTimestamp;
        const interval = 1000 / engine.params.speed;
        if (elapsed >= interval) {
            lastTimestamp = timestamp - (elapsed % interval);
            engine.update();
            tickCount++;
            updateUI(els, engine);
        }

        rafId = requestAnimationFrame(loop);
    }

    function togglePause() {
        isPaused = !isPaused;
        els.btnPause.innerText        = isPaused ? "Resume" : "Pause";
        els.btnPause.style.background = isPaused ? "#4cd137" : "#e1b12c";
        if (isPaused) {
            cancelAnimationFrame(rafId);
            rafId = null;
        } else {
            lastTimestamp = 0;
            rafId = requestAnimationFrame(loop);
        }
    }

    function stepYear() {
        for (let i = 0; i < 4; i++) engine.update();
        draw(glState, engine);
        updateUI(els, engine);
    }

    // Initial render before the loop starts
    draw(glState, engine);
    updateUI(els, engine);
    rafId = requestAnimationFrame(loop);

    // Controls
    document.getElementById('btn-pause').addEventListener('click', togglePause);
    document.getElementById('btn-step').addEventListener('click',  stepYear);
    document.getElementById('btn-reset').addEventListener('click', () => {
        engine.reset();
        draw(glState, engine);
        updateUI(els, engine);
    });

    document.getElementById('in-speed').addEventListener('input', (e) =>
        engine.params.speed = parseInt(e.target.value));

    document.getElementById('in-scenario').addEventListener('change', (e) =>
        engine.params.sensitivity = parseFloat(e.target.value));

    document.getElementById('in-temp-bias').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        engine.params.tempAnomaly = val;
        document.getElementById('val-temp-bias').innerText = "+" + val.toFixed(1) + "°C";
    });

    document.getElementById('in-rain-bias').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        engine.params.rainBias = val;
        let lbl = "Normal";
        if (val < 1) lbl = "Drought";
        if (val > 1) lbl = "Wet";
        document.getElementById('val-rain-bias').innerText = `${lbl} (${val.toFixed(1)}×)`;
    });

    document.getElementById('in-metabolism').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        engine.params.basalMetabolism = val;
        document.getElementById('val-metabolism').innerText = val.toFixed(3);
    });

    document.getElementById('in-growth').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        engine.params.growthRate = val;
        document.getElementById('val-growth').innerText = val.toFixed(1) + "×";
    });

    document.getElementById('in-fire').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        engine.params.fireFreq = val;
        document.getElementById('val-fire').innerText = val.toFixed(1) + "×";
    });

    window.sim = engine; // expose for browser console debugging
};
