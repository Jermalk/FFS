import { ISSUES } from './issues.js';

// ---------------------------------------------------------------------------
// Helpers injected into every scenario fn
// ---------------------------------------------------------------------------

function runYears(sim, years) {
    for (let i = 0; i < years * 4; i++) sim.update();
}

function clearGrid(sim) {
    sim.stateGrid.fill(0);
    sim.nextStateGrid.fill(0);
    sim.ageGrid.fill(0);
    sim.nextAgeGrid.fill(0);
    sim.stats = { biomass: 0, oldGrowth: 0 };
}

function countTrees(sim) {
    let n = 0;
    for (let i = 0; i < sim.size; i++) if (sim.stateGrid[i] === 1) n++;
    return n;
}

// ---------------------------------------------------------------------------
// CSS injected once per page load
// ---------------------------------------------------------------------------

function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .covers-row { margin-bottom: 8px; display: flex; flex-wrap: wrap; gap: 4px; }
        .covers-tag {
            background: #1a2e1a; border: 1px solid #2d4a2d; color: #5aaa5a;
            font-size: 0.72rem; padding: 2px 6px; border-radius: 2px;
        }
        #download-controls {
            margin-top: 16px; display: flex; gap: 10px; align-items: center;
        }
        #download-controls label { color: #888; }
        #commit-input {
            background: #1e1e1e; border: 1px solid #444; color: #fff;
            padding: 4px 8px; font-family: monospace; width: 180px;
        }
        #download-btn {
            background: #2d2d2d; border: 1px solid #555; color: #ccc;
            padding: 6px 14px; cursor: pointer; font-family: monospace;
        }
        #download-btn:hover { background: #383838; }
        #gap-report {
            margin-top: 14px; background: #1a1a2a; border: 1px solid #333;
            border-radius: 4px; padding: 14px;
        }
        .gap-title { color: #fab1a0; font-weight: bold; margin-bottom: 8px; font-size: 0.9rem; }
        .gap-row { font-size: 0.82rem; color: #888; margin-bottom: 3px; }
    `;
    document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// createSuite — main entry point
// ---------------------------------------------------------------------------

export function createSuite(suiteId, suiteTitle) {
    const pending = [];

    function scenario(id, title, covers, fn) {
        for (const issueId of covers) {
            if (!ISSUES[issueId]) throw new Error(`Unknown issue ID "${issueId}" in scenario ${id}`);
        }
        pending.push({ id, title, covers, fn });
    }

    function run() {
        injectStyles();
        document.getElementById('running').style.display = 'none';

        const out = document.getElementById('output');
        let totalPassed = 0, totalFailed = 0;
        const resultScenarios = [];
        const coveredIds = new Set();

        for (const sc of pending) {
            const values = [];
            const checks = [];
            let scPassed = 0, scFailed = 0;

            function val(label, value) {
                values.push({ label, value: String(value) });
            }

            function check(label, condition, detail) {
                const pass = !!condition;
                checks.push({ label, pass, detail: detail ?? '' });
                if (pass) { scPassed++; totalPassed++; }
                else       { scFailed++; totalFailed++; }
            }

            sc.fn({ val, check, runYears, clearGrid, countTrees });

            // Render scenario card
            const div = document.createElement('div');
            div.className = 'scenario';

            const coversHtml = sc.covers.map(id =>
                `<span class="covers-tag">${id}: ${ISSUES[id].title}</span>`
            ).join('');

            const valHtml = values.map(({ label, value }) =>
                `<div class="row"><span class="label">${label}</span><span class="value">${value}</span></div>`
            ).join('');

            const checksHtml = checks.map(({ label, pass, detail }) =>
                `<div class="row"><span class="label">${label}</span><span class="${pass ? 'pass' : 'fail'}">${pass ? 'PASS' : 'FAIL'}</span>` +
                (detail ? `<span class="value" style="margin-left:10px;color:${pass ? '#888' : '#ff4757'}">${detail}</span>` : '') +
                `</div>`
            ).join('');

            div.innerHTML =
                `<div class="scenario-title">${sc.id} — ${sc.title}</div>` +
                `<div class="covers-row">${coversHtml}</div>` +
                valHtml +
                `<hr class="separator">` +
                checksHtml;

            out.appendChild(div);

            for (const id of sc.covers) coveredIds.add(id);
            resultScenarios.push({
                id: sc.id, title: sc.title,
                covers: sc.covers.map(id => ({ id, ...ISSUES[id] })),
                passed: scPassed, failed: scFailed,
                values, checks,
            });
        }

        // Summary bar
        const total = totalPassed + totalFailed;
        const summary = document.getElementById('summary');
        summary.className = totalFailed === 0 ? 'all-pass' : 'has-fail';
        summary.textContent = totalFailed === 0
            ? `All ${total} checks passed`
            : `${totalFailed} of ${total} checks FAILED`;

        // Commit input + download button
        const today = new Date().toISOString().slice(0, 10);
        const controls = document.createElement('div');
        controls.id = 'download-controls';
        controls.innerHTML =
            `<label>Commit hash:</label>` +
            `<input id="commit-input" type="text" placeholder="e.g. fa18e9f" maxlength="40">` +
            `<button id="download-btn">Download JSON</button>`;
        summary.after(controls);

        document.getElementById('download-btn').addEventListener('click', () => {
            const commit = document.getElementById('commit-input').value.trim() || 'unknown';
            const uncovered = Object.keys(ISSUES).filter(id => !coveredIds.has(id));
            const payload = {
                suite: suiteId,
                timestamp: new Date().toISOString(),
                commit,
                passed: totalPassed, failed: totalFailed, total,
                uncovered_issues: uncovered,
                scenarios: resultScenarios,
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${suiteId}_${today}_${commit}.json`;
            a.click();
        });

        // Gap report
        const uncovered = Object.keys(ISSUES).filter(id => !coveredIds.has(id));
        if (uncovered.length > 0) {
            const gapDiv = document.createElement('div');
            gapDiv.id = 'gap-report';
            gapDiv.innerHTML =
                `<div class="gap-title">Issues with no test coverage in this suite (${uncovered.length})</div>` +
                uncovered.map(id => `<div class="gap-row">${id}: ${ISSUES[id].title}</div>`).join('');
            controls.after(gapDiv);
        }
    }

    return { scenario, run };
}
