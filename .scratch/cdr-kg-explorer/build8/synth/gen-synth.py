#!/usr/bin/env python3
"""Generate 30 clinically varied synthetic IPS patients for V8 + the terminology nodes they need.
Input : ../v8-data.base.js (the bilingual V8 payload as merged from V7; never modified)
Output: ../../lib/v8-data.js  (base + D.synth compact specs + new D.ont nodes/edges/clusters)
SNOMED CT closure + labels from tx-nordics ($lookup, SE edition for sv, International for en), cached in sct-cache-synth.json.
Deterministic: fixed RNG seed."""
import json, os, random, sys, urllib.request, urllib.parse, concurrent.futures as cf
from functools import lru_cache
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from pool import *
BASE = HERE.parent / "v8-data.base.js"; OUT = HERE.parents[1] / "lib/v8-data.js"
raw = BASE.read_text(); i = raw.index("{"); PREFIX = raw[:i]; D = json.loads(raw[i:].rstrip().rstrip(";"))
NODES = {n["id"]: n for n in D["ont"]["nodes"]}
NOW = 2026
rng = random.Random(20261117)

# ---------------- patients ----------------
def pick_alt(alts): return alts[0] if len(alts) == 1 else rng.choice(alts)
def date(y, lo=1, hi=12): return f"{y}-{rng.randint(lo, hi):02d}-{rng.randint(1, 28):02d}"
usage = {k: 0 for k in PROB}
COMORB = {"dm2": [("hypertoni", .6), ("lipid", .5)], "hjartsvikt": [("ff", .4), ("hypertoni", .5)], "angina": [("lipid", .7), ("hypertoni", .4)],
          "kol": [("hjartsvikt", .15)], "stroke": [("hypertoni", .6), ("ff", .3)], "ckd": [("hypertoni", .7)], "depression": [("angest", .25)],
          "astma": [("rinit", .35)], "osteoporos": [("radiusfraktur", 0)], "gonartros": [("hypertoni", .3)], "somnapne": [("hypertoni", .5)]}
def ok(k, sex, age):
    p = PROB[k]
    return (p.get("sex") in (None, sex)) and p["age"][0] <= age <= p["age"][1]
SEXES = ["F", "M"] * 15; rng.shuffle(SEXES)
AGES = sorted([rng.randint(22, 92) for _ in range(30)]); rng.shuffle(AGES)
FRACTURE_AT = None
pats = []
for idx in range(30):
    sex, age = SEXES[idx], AGES[idx]
    n = rng.choice([1, 2, 2, 2, 3, 3, 4]) if age >= 50 else rng.choice([1, 1, 2, 2, 3])
    probs = []
    while len(probs) < n:
        cand = [k for k in PROB if PROB[k]["w"] > 0 and k not in probs and ok(k, sex, age)]
        if not cand: break
        m = min(usage[k] for k in cand)                     # balance: least used first, weighted by prevalence
        cand = [k for k in cand if usage[k] <= m + 1]
        k = rng.choices(cand, weights=[PROB[c]["w"] / (1 + 2 * usage[c]) for c in cand])[0]
        probs.append(k); usage[k] += 1
        for c, pr in COMORB.get(k, []):
            if len(probs) < n + 1 and c not in probs and ok(c, sex, age) and rng.random() < pr: probs.append(c); usage[c] += 1
    pats.append({"sex": sex, "age": age, "probs": probs})
# exactly one patient gets the (Eva-style) radius fracture: an older woman, preferably with osteoporosis
cands = [i for i, p in enumerate(pats) if p["sex"] == "F" and p["age"] >= 65]
fi = next((i for i in cands if "osteoporos" in pats[i]["probs"]), cands[0] if cands else 0)
pats[fi]["probs"].insert(0, "radiusfraktur"); usage["radiusfraktur"] += 1

def V(sv, en=None): return {"sv": sv, "en": en if en is not None else sv}
def num(lo, hi, dec): x = rng.uniform(lo, hi); return f"{x:.{dec}f}" if dec else str(int(round(x)))
def strength_txt(s): return f"{s} mg" if isinstance(s, (int, float)) else s
SEV = {1: ("Lindrig (local::at0047)", "Mild (local::at0047)"), 2: ("Måttlig (local::at0048)", "Moderate (local::at0048)"), 3: ("Svår (local::at0049)", "Severe (local::at0049)")}
specs = []
for idx, P in enumerate(pats, 1):
    sex, age = P["sex"], P["age"]; born = NOW - age
    ent = []
    meds, labs, procs, vacc, allergies = [], {}, [], set(), []
    for k in P["probs"]:
        p = PROB[k]
        active = p.get("active", True)
        if k == "radiusfraktur": onset = date(2026, 1, 3)
        elif not active: onset = date(rng.randint(2023, 2025))
        else: onset = date(rng.randint(max(born + max(p["age"][0], 18), NOW - 25), NOW - 1))
        s = {"Problem/Diagnosis name": {"v": V(p["sv"], p["en"]), "c": ["sct:" + p["sct"], "icd10:" + p["icd"]]},
             "Date/time of onset": {"v": onset}}
        if p.get("site"):
            a, b, c = SITE[p["site"]]; s["Body site"] = {"v": V(a, b), "c": ["sct:" + c]}
        else: s["Body site"] = None
        if p.get("sev") or k == "radiusfraktur":
            sv_, en_ = SEV[rng.choice([1, 2, 2, 3]) if k != "radiusfraktur" else 2]; s["Severity"] = {"v": V(sv_, en_)}
        else: s["Severity"] = None
        s["Active/Inactive?"] = {"v": V("Aktiv (local::at0026)", "Active (local::at0026)") if active else V("Inaktiv (local::at0027)", "Inactive (local::at0027)")}
        ent.append({"t": "eva:ips/e0", "n": V(p["sv"], p["en"]), "s": s})
        for alts in p.get("meds", []):
            m = pick_alt(alts)
            if m not in meds and not any(MED[x][1][:5] == MED[m][1][:5] for x in meds): meds.append(m)   # no two drugs from the same ATC chemical subgroup
        for lk_, rngv in p.get("labs", {}).items(): labs.setdefault(lk_, rngv)
        for pr in p.get("proc", []):
            if pr not in procs and (pr != "pci" or rng.random() < .6) and (pr != "knaprotes" or rng.random() < .5): procs.append(pr)
        for v_ in p.get("vacc", []): vacc.add(v_)
        if p.get("allergy"): allergies.append(p["allergy"])
    if "apixaban" in meds: meds = [m for m in meds if m not in ("klopidogrel", "asa")]   # anticoagulated: no extra antiplatelet
    P["meds"] = meds
    # allergies
    if not allergies and rng.random() < .4:
        pool_ = [a for a in ALLERGY if not (a == "penicillin" and ("pcv" in meds or "amoxicillin" in meds or "pivmecillinam" in meds))]
        allergies.append(rng.choice(pool_))
    for a in allergies:
        sc, ssv, sen, nsv, nen, typ, man, crit = ALLERGY[a]; msv, men, mc = MANIF[man]
        ent.append({"t": "eva:ips/e2", "n": V(nsv, nen), "s": {
            "Substance": {"v": V(ssv, sen), "c": ["sct:" + sc]},
            "Criticality": {"v": V("Hög (local::at0103)", "High (local::at0103)") if crit == "high" else V("Låg (local::at0102)", "Low (local::at0102)")},
            "Manifestation": {"v": V(msv, men), "c": ["sct:" + mc]},
            "Severity": {"v": V("Svår (local::at0090)", "Severe (local::at0090)") if crit == "high" else rng.choice([V("Lindrig (local::at0093)", "Mild (local::at0093)"), V("Måttlig (local::at0092)", "Moderate (local::at0092)")])}}})
    # medications
    for m in meds:
        sc, atc, nsv, nen, st, form, dose, unit, freq, route = MED[m]
        rsv, ren, rc = ROUTE[route]; stt = strength_txt(st)
        item = V(f"{nsv[0].upper()+nsv[1:]} {stt} {form[0]}", f"{nen[0].upper()+nen[1:]} {stt} {form[1]}")
        fr = V(f"{freq} /d") if isinstance(freq, int) else (V("vid behov", "as needed") if freq == "vid behov" else V(freq.replace("vecka", "vecka"), freq.replace("vecka", "week")))
        ent.append({"t": "eva:ips/e3", "n": V(f"{nsv[0].upper()+nsv[1:]} {stt}", f"{nen[0].upper()+nen[1:]} {stt}"), "s": {
            "Medication item": {"v": item}, "Name": {"v": V(nsv, nen), "c": ["sct:" + sc, "atc:" + atc]},
            "Form": {"v": V(*form)}, "Strength numerator": {"v": V(stt)}, "Dose amount": {"v": V(str(dose))},
            "Dose unit": {"v": V(*unit)}, "Frequency": {"v": fr}, "Route": {"v": V(rsv, ren), "c": ["sct:" + rc]}}})
    # immunisations
    if age >= 65: vacc |= {"influensa", "pneumokock"} if rng.random() < .8 else {"influensa"}
    if age >= 65 and rng.random() < .7: vacc.add("covid")
    if any(k in P["probs"] for k in ("kol", "astma", "dm2", "dm1", "hjartsvikt", "ckd")) and rng.random() < .8: vacc.add("influensa")
    if rng.random() < .3: vacc.add("tbe")
    if rng.random() < .3: vacc.add("ditebooster")
    for v_ in [x for x in VACC if x in vacc]:
        sc, atc, isv, ien, nsv, nen = VACC[v_]
        site = rng.choice([("vänster överarm", "left upper arm", "368208006"), ("höger överarm", "right upper arm", "368209003")])
        ent.append({"t": "eva:ips/e4", "n": V(nsv, nen), "s": {"Immunisation item": {"v": V(isv, ien), "c": ["sct:" + sc, "atc:" + atc]},
            "Target site": {"v": V(site[0], site[1]), "c": ["sct:" + site[2]]}, "Sequence number": {"v": V(str(rng.choice([1, 1, 2, 3]) if v_ in ("tbe", "covid") else 1))}}})
    # procedures: problem-driven + maybe one past surgical history item
    hist = [k for k, v in PROC.items() if k not in ("pci", "lumpektomi", "frakturfix", "knaprotes") and v[4] in (None, sex) and age >= v[5]]
    if rng.random() < .55: procs.append(rng.choice(hist))
    for pr in dict.fromkeys(procs):
        sc, psv, pen, site, _, _ = PROC[pr]
        s = {"Procedure name": {"v": V(psv, pen), "c": ["sct:" + sc]}}
        s["Body site"] = {"v": V(site[0], site[1]), "c": ["sct:" + site[2]]} if site else None
        ent.append({"t": "eva:ips/e5", "n": V(psv, pen), "s": s})
    # diagnostic results
    if not labs: labs[rng.choice(["hb", "krea", "crp"])] = None
    for lk_, rngv in labs.items():
        code, tsv, ten, an, unit, normal, dec = LAB[lk_]
        lo, hi = rngv or normal
        if lk_ == "hb" and rngv is None and sex == "M": lo, hi = 8.4, 9.8
        val = num(lo, hi, dec)
        ent.append({"t": "eva:ips/e6", "n": V(tsv, ten), "s": {"Test name": {"v": V(tsv, ten)}, "Analyte name": {"v": V(an), "c": ["npu:" + code]}, "Analyte result": {"v": V(f"{val} {unit}")}}})
    # vital signs, coherent with the problems
    htn = "hypertoni" in P["probs"]
    sysbp = rng.randint(132, 154) if htn else rng.randint(108, 134) + max(0, age - 50) // 4
    diabp = rng.randint(80, 94) if htn else rng.randint(66, 84)
    pulse = rng.randint(78, 98) if "ff" in P["probs"] else rng.randint(56, 80)
    spo2 = rng.randint(90, 94) if "kol" in P["probs"] else rng.randint(95, 99)
    w = rng.uniform(55, 82) if sex == "F" else rng.uniform(68, 98)
    if any(k in P["probs"] for k in ("dm2", "somnapne")): w += rng.uniform(8, 20)
    ent += [{"t": "eva:ips/e7", "n": V("Blodtryck", "Blood pressure"), "s": {"Systolic": {"v": V(f"{sysbp} mm[Hg]")}, "Diastolic": {"v": V(f"{diabp} mm[Hg]")}}},
            {"t": "eva:ips/e8", "n": V("Puls", "Pulse"), "s": {"Rate": {"v": V(f"{pulse} /min")}}},
            {"t": "eva:ips/e9", "n": V("Pulsoximetri", "Pulse oximetry"), "s": {"SpO₂": {"v": V(f"{spo2} %")}}},
            {"t": "eva:ips/e10", "n": V("Kroppsvikt", "Body weight"), "s": {"Weight": {"v": V(f"{w:.1f} kg")}}}]
    specs.append({"i": idx, "born": born, "sex": "female" if sex == "F" else "male", "date": date(2026, 4, 10), "e": ent})

# ---------------- terminology ----------------
codes = sorted({c for s in specs for e in s["e"] for x in e["s"].values() if x for c in x.get("c", [])})
new_sct = [c[4:] for c in codes if c.startswith("sct:")]
LKB = "https://tx-nordics.fhir.org/fhir/r4/CodeSystem/$lookup"; SE = "http://snomed.info/sct/45991000052106"; INTL = "http://snomed.info/sct/900000000000207008"
CACHE = HERE / "sct-cache-synth.json"; S = json.loads(CACHE.read_text()) if CACHE.exists() else {}
def lookup(code, ver, lang):
    q = urllib.parse.urlencode([("system", "http://snomed.info/sct"), ("version", ver), ("code", code), ("property", "parent"), ("property", "inactive"), ("displayLanguage", lang), ("_format", "json")])
    for _ in range(3):
        try: d = json.load(urllib.request.urlopen(urllib.request.Request(LKB + "?" + q, headers={"Accept": "application/fhir+json"}), timeout=40)); break
        except Exception as e: err = e
    else: return None
    r = {"d": None, "parents": [], "inactive": None}
    for p in d.get("parameter", []):
        if p["name"] == "display": r["d"] = p.get("valueString")
        if p["name"] == "property":
            pp = {x["name"]: x for x in p["part"]}; k = pp["code"].get("valueCode")
            if k == "parent": r["parents"].append(pp["value"].get("valueCode"))
            if k == "inactive": r["inactive"] = pp["value"].get("valueBoolean")
    return r
def one(code):
    a = lookup(code, SE, "sv"); b = lookup(code, INTL, "en") or lookup(code, SE, "en")
    if not a: raise SystemExit("lookup failed " + code)
    return code, {"sv": a["d"], "en": (b or {}).get("d") or a["d"], "parents": a["parents"], "inactive": a["inactive"]}
# existing nodes: parents come from the existing edge list
EXP = {}
for c, p in D["ont"]["edges"]: EXP.setdefault(c, []).append(p)
def parents(c): return EXP.get("sct:" + c) and [x[4:] for x in EXP["sct:" + c]] if ("sct:" + c) in NODES else S[c]["parents"]
front = [c for c in new_sct if "sct:" + c not in NODES]
with cf.ThreadPoolExecutor(8) as ex:
    while front:
        todo = sorted({c for c in front if c not in S}); front = []
        for code, r in ex.map(one, todo): S[code] = r
        front = [p for c in todo for p in S[c]["parents"] if "sct:" + p not in NODES and p not in S]
CACHE.write_text(json.dumps(S, ensure_ascii=False, indent=0))
bad = [c for c in new_sct if "sct:" + c not in NODES and (S[c]["inactive"] or not S[c]["sv"])]
assert not bad, ("inactive/missing SNOMED codes", bad)
ROOT = "138875005"
def par(c): return [x[4:] for x in EXP.get("sct:" + c, [])] if "sct:" + c in NODES else S[c]["parents"]
USED = sorted({n["code"] for n in D["ont"]["nodes"] if n["sys"] == "sct" and n["used"]} | set(new_sct))
@lru_cache(None)
def anc(c):
    a = set()
    for p in par(c): a |= {p} | anc(p)
    return frozenset(a)
CL = set(USED) | {a for u in USED for a in anc(u)}
kids = {c: [] for c in CL}
for c in CL:
    for p in par(c): kids[p].append(c)
ud = {c: frozenset(u for u in USED if u == c or c in anc(u)) for c in CL}
keep = set(USED) | {ROOT} | {c for c in CL if ROOT in par(c)}
for c in CL:
    if c in keep: continue
    if len(kids[c]) >= 2 and all(ud[k] != ud[c] for k in kids[c]): keep.add(c)
rest = CL - keep
@lru_cache(None)
def kd(c):
    r = set()
    for k in kids[c]: r |= {k} if k in keep else set(kd(k))
    return frozenset(r)
comp = {}
for c in sorted(rest):
    if c in comp: continue
    cid = len(set(comp.values())) + 1; st = [c]; comp[c] = cid
    while st:
        x = st.pop()
        for y in par(x) + kids[x]:
            if y in rest and y not in comp and kd(y) == kd(c): comp[y] = cid; st.append(y)
groups = {}
for c, cid in comp.items():
    if "sct:" + c not in NODES: groups.setdefault(cid, []).append(c)   # existing nodes keep their V7 cluster
newcl = sorted([sorted(m) for m in groups.values() if len(m) >= 2], key=lambda m: (-len(m), m))
base_n = len(D["ont"]["clusters"])
clof = {}
for j, m in enumerate(newcl, base_n + 1):
    D["ont"]["clusters"].append({"id": f"sct:cl{j}", "sys": "sct", "members": ["sct:" + x for x in m]})
    for x in m: clof[x] = f"sct:cl{j}"
added = {"sct": 0, "icd10": 0, "atc": 0, "npu": 0}; edges = set(map(tuple, D["ont"]["edges"]))
def addnode(n):
    if n["id"] in NODES: return
    NODES[n["id"]] = n; D["ont"]["nodes"].append(n); added[n["sys"]] += 1
for c in sorted(CL):
    if "sct:" + c in NODES: continue
    addnode({"id": "sct:" + c, "sys": "sct", "code": c, "used": False, "kept": c in keep, "cluster": clof.get(c), "inactive": bool(S[c]["inactive"]), "sv": S[c]["sv"], "en": S[c]["en"], "synth": True})
    for p in S[c]["parents"]: edges.add(("sct:" + c, "sct:" + p))
def addchain(sys, table, code, root):
    while code in table:
        p, sv, en = table[code]
        addnode({"id": f"{sys}:{code}", "sys": sys, "code": code, "used": False, "inactive": False, "kept": True, "cluster": None, "sv": sv, "en": en, "synth": True})
        pid = f"{sys}:{root}" if p == root else f"{sys}:{p}"
        edges.add((f"{sys}:{code}", pid)); code = p
for c in codes:
    sys_, code = c.split(":", 1)
    if sys_ == "icd10": addchain("icd10", ICD, code, "WHO-ICD-10")
    if sys_ == "atc": addchain("atc", ATC, code, "ROOT")
    if sys_ == "npu" and c not in NODES:
        addnode({"id": c, "sys": "npu", "code": code, "used": False, "inactive": False, "kept": True, "cluster": None, "sv": NPU[code][0], "en": NPU[code][1], "synth": True}); edges.add((c, "npu:NPU"))
missing = [c for c in codes if c not in NODES]
assert not missing, missing
D["ont"]["edges"] = [list(e) for e in D["ont"]["edges"]] + [list(e) for e in sorted(edges - set(map(tuple, D["ont"]["edges"])))]
for c, p in D["ont"]["edges"]: assert c in NODES and p in NODES, (c, p)
D["synth"] = specs
D["note"]["synth"] = {"sv": "30 syntetiska patienter genererade av build8/synth/gen-synth.py (seed 20261117)", "en": "30 synthetic patients generated by build8/synth/gen-synth.py (seed 20261117)"} if isinstance(D["note"], dict) else None
OUT.write_text(PREFIX + json.dumps(D, ensure_ascii=False, separators=(",", ":")) + ";")
# report
print("added nodes", added, "new clusters", len(newcl), "edges", len(D["ont"]["edges"]))
print("problem usage", {k: v for k, v in sorted(usage.items(), key=lambda x: -x[1])})
for s, P in zip(specs, pats): print(f"Syntetisk {s['i']:02d} {P['sex']} {P['age']:>2}: " + ", ".join(PROB[k]["sv"] for k in P["probs"]) + " | " + ", ".join(P["meds"]))
