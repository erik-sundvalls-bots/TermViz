#!/usr/bin/env python3
"""Print the ADL_SCT_BINDINGS constant for v8-src.html: SNOMED CT term_bindings per archetype and at-code,
read from the IPS fileset ADL files (public/models/ips-fileset/archetypes). LOINC bindings are listed on stderr only:
the V8 terminology layer has no LOINC band (Swedish code systems are preferred).
Usage: python3 extract-adl-bindings.py [archetype-dir]"""
import glob, json, os, re, sys
root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../public/models/ips-fileset/archetypes")
pat = re.compile(r'\["(at\d+(?:\.\d+)*)"\]\s*=\s*<\[([A-Za-z0-9_\-]+)(?:\([^)]*\))?::([^\]]+)\]>')
out, other = {}, []
for f in sorted(glob.glob(os.path.join(root, "**/*.adl"), recursive=True)):
    s = open(f, encoding="utf-8-sig").read()
    i = s.find("term_bindings")
    if i < 0: continue
    aid = os.path.basename(f)[:-4]
    for at, term, code in pat.findall(s[i:]):
        if term.upper().startswith("SNOMED"): out.setdefault(aid, {})[at] = code.strip()
        else: other.append(f"{aid} {at} {term}::{code}")
print("const ADL_SCT_BINDINGS = " + json.dumps(out, separators=(",", ":")) + ";")
for o in other: print("not SNOMED (skipped):", o, file=sys.stderr)
