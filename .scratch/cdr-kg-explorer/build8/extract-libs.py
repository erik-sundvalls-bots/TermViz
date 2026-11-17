#!/usr/bin/env python3
"""Recover the inlined libraries from a published V8 HTML into ../lib/ (d3, d3-dag, ehrtslib bundle; data optional).
Usage: python3 extract-libs.py path/to/v8-multilingual-stack-demo.html [--data]"""
import re, sys
from pathlib import Path
html = Path(sys.argv[1]).read_text(); lib = Path(__file__).resolve().parent.parent / "lib"; lib.mkdir(exist_ok=True)
scripts = [(m.start(), m.group(1)) for m in re.finditer(r"<script>(.*?)</script>", html, re.S)]
def find(pred):
    for _, s in scripts:
        if pred(s): return s
    raise SystemExit("not found")
out = {"d3.min.js": find(lambda s: s.startswith("// https://d3js.org v")),
       "d3-dag.min.js": find(lambda s: "d3-dag" in s[:300] or "sugiyama" in s[:5000] and "graphStratify" in s and len(s) < 400000 and not s.startswith("// https://d3js.org")),
       "ehrtslib-v012-browser.min.js": find(lambda s: "EHRTSlib" in s[:2000])}
if "--data" in sys.argv: out["v8-data.js"] = find(lambda s: s.startswith("window.V8="))
for k, v in out.items(): (lib / k).write_text(v); print(k, len(v))
