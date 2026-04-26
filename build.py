#!/usr/bin/env python3
"""
build.py — produce dist/index.htm: a single self-contained file that runs
directly from file:// without a web server or any dependencies.

Usage:
    python3 build.py

The dev source files (simulation-engine.js, simulation.js, index.htm) are
unchanged. Edit those, then re-run this script to rebuild dist/index.htm.
"""
import os, re, sys

SRC_ENGINE = 'simulation-engine.js'
SRC_SIM    = 'simulation.js'
SRC_HTML   = 'index.htm'
OUT_DIR    = 'dist'
OUT_FILE   = os.path.join(OUT_DIR, 'index.htm')

# Anchor we look for in index.htm to know where to inline the script
SCRIPT_TAG = '<script type="module" src="simulation.js"></script>'

def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()

def write(path, content):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

# ---- Load sources -----------------------------------------------------------
engine_js = read(SRC_ENGINE)
sim_js    = read(SRC_SIM)
html      = read(SRC_HTML)

# ---- Strip ES-module syntax -------------------------------------------------
# Remove 'export ' prefix from top-level declarations in simulation-engine.js
engine_js = re.sub(r'^export\s+', '', engine_js, flags=re.MULTILINE)

# Remove the single import line from simulation.js
sim_js = re.sub(r"^import\s+\{[^}]+\}\s+from\s+'[^']+';?\n", '', sim_js, flags=re.MULTILINE)

# ---- Verify nothing was missed ----------------------------------------------
remaining_exports = re.findall(r'^export\s+', engine_js, flags=re.MULTILINE)
remaining_imports = re.findall(r'^import\s+', sim_js,    flags=re.MULTILINE)
if remaining_exports:
    sys.exit(f'ERROR: unstripped exports remain in {SRC_ENGINE}: {remaining_exports}')
if remaining_imports:
    sys.exit(f'ERROR: unstripped imports remain in {SRC_SIM}: {remaining_imports}')

# ---- Inline into HTML -------------------------------------------------------
bundled_tag = '<script type="module" src='  # must be absent in output
if SCRIPT_TAG not in html:
    sys.exit(f'ERROR: expected script tag not found in {SRC_HTML}:\n  {SCRIPT_TAG}')

bundle      = engine_js + '\n\n' + sim_js
replacement = f'<script>\n{bundle}\n</script>'
html        = html.replace(SCRIPT_TAG, replacement)

# ---- Write output -----------------------------------------------------------
os.makedirs(OUT_DIR, exist_ok=True)
write(OUT_FILE, html)

# ---- Sanity check output ----------------------------------------------------
out = read(OUT_FILE)
if bundled_tag in out:
    sys.exit(f'ERROR: output still contains a module script src tag — bundle incomplete')

size_kb = os.path.getsize(OUT_FILE) // 1024
print(f'Built:  {OUT_FILE}  ({size_kb} KB)')
print('Open dist/index.htm directly in any browser — no server needed.')
