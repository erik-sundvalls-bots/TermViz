#!/usr/bin/env python3
"""Merge Swedish and English V7 data into one bilingual V8 payload. Does not touch V7 files."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SV = json.loads((ROOT / "lib/v7-data.js").read_text()[len("window.V7="):].rstrip().rstrip(";"))
EN = json.loads((ROOT / "lib/v7-data-en.js").read_text()[len("window.V7="):].rstrip().rstrip(";"))

def loc(sv, en):
    if sv == en:
        return sv if sv is not None else ""
    return {"sv": sv if sv is not None else (en or ""), "en": en if en is not None else (sv or "")}

def merge_val(a, b):
    """Merge two parallel values (string or dict or list or other)."""
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a.keys()) == {"sv", "en"} and set(b.keys()) == {"sv", "en"}:
            return loc(a.get("sv"), b.get("en") or a.get("en"))
        keys = list(dict.fromkeys([*a.keys(), *b.keys()]))
        return {k: merge_val(a.get(k), b.get(k)) for k in keys}
    if isinstance(a, list) and isinstance(b, list):
        n = max(len(a), len(b))
        return [merge_val(a[i] if i < len(a) else None, b[i] if i < len(b) else None) for i in range(n)]
    if isinstance(a, str) or isinstance(b, str):
        # only bilingual-ize known text fields at the caller; here if both strings and differ, return loc
        if isinstance(a, str) and isinstance(b, str) and a != b:
            return loc(a, b)
        return a if a is not None else b
    return a if a is not None else b

TEXT_KEYS = {"name", "short", "label", "value", "note", "sv", "en"}

def merge_node(a, b):
    if not isinstance(a, dict):
        return merge_val(a, b)
    b = b or {}
    out = {}
    keys = list(dict.fromkeys([*a.keys(), *b.keys()]))
    for k in keys:
        va, vb = a.get(k), b.get(k)
        if k in TEXT_KEYS and (isinstance(va, str) or isinstance(vb, str) or va is None or vb is None):
            # instance/template/archetype display strings
            if k == "sv":
                continue  # handled with en on ont nodes separately
            if k == "en":
                continue
            out[k] = loc(va if isinstance(va, str) else (va if va is not None else ""),
                         vb if isinstance(vb, str) else (vb if vb is not None else va))
        elif k == "children" and isinstance(va, list):
            out[k] = [merge_node(va[i], (vb or [None]*len(va))[i] if vb and i < len(vb) else None) for i in range(len(va))]
        elif isinstance(va, dict) and isinstance(vb, dict) and "children" in va or (isinstance(va, dict) and va.get("k") and "name" in va):
            out[k] = merge_node(va, vb)
        elif isinstance(va, list) and va and isinstance(va[0], dict) and "name" in va[0]:
            out[k] = [merge_node(va[i], vb[i] if isinstance(vb, list) and i < len(vb) else None) for i in range(len(va))]
        else:
            out[k] = va if va is not None else vb
    return out

# --- ontology ---
ont_nodes = []
en_by_id = {n["id"]: n for n in EN["ont"]["nodes"]}
for n in SV["ont"]["nodes"]:
    e = en_by_id[n["id"]]
    # English demo stored English displays in the `sv` field; Swedish file has true sv + en for ICD/ATC/NPU.
    sv_lab = n.get("sv") or n.get("en") or n["code"]
    en_lab = e.get("sv") or n.get("en") or e.get("en") or sv_lab
    ont_nodes.append({
        **{k: n[k] for k in n if k not in ("sv", "en")},
        "sv": sv_lab,
        "en": en_lab,
    })

# --- archetypes / templates / patients ---
archetypes = [merge_node(a, b) for a, b in zip(SV["archetypes"], EN["archetypes"])]
templates = [merge_node(a, b) for a, b in zip(SV["templates"], EN["templates"])]
patients = [merge_node(a, b) for a, b in zip(SV["patients"], EN["patients"])]

out = {
    "note": loc(SV["note"], EN["note"]),
    "ont": {
        "nodes": ont_nodes,
        "edges": SV["ont"]["edges"],
        "clusters": SV["ont"]["clusters"],
    },
    "archetypes": archetypes,
    "templates": templates,
    "patients": patients,
}

# sanity
def count_loc(o, acc=None):
    acc = acc or [0]
    if isinstance(o, dict):
        if set(o.keys()) <= {"sv", "en"} and "sv" in o:
            acc[0] += 1
        for v in o.values():
            count_loc(v, acc)
    elif isinstance(o, list):
        for v in o:
            count_loc(v, acc)
    return acc[0]

text = "window.V8=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";"
dest = ROOT / "lib/v8-data.js"
dest.write_text(text)
print("wrote", dest, "bytes", len(text), "loc-objects", count_loc(out))
print("ont", len(ont_nodes), "arch", len(archetypes), "tpl", len(templates), "pats", len(patients))
# show a few label pairs
for n in ont_nodes[:2]:
    print(" ", n["id"], n["sv"], "|", n["en"])
print(" tpl0", templates[0]["name"], templates[0]["short"])
print(" tpl1", templates[1]["name"], templates[1]["short"])
print(" eva first problem", patients[0]["children"][0]["children"][0]["children"][0]["name"])
