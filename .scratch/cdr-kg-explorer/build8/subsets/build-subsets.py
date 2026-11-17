#!/usr/bin/env python3
"""Build minimal Swedish terminology subsets for the V8 demo (codes used + ancestors only).
Writes JSON to public/prototyping/subsets/. Does not commit full source files."""
import io
import json
import re
import sys
import urllib.parse
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
LIB = Path(__file__).resolve().parents[2] / "lib" / "v8-data.js"
OUT = ROOT / "public" / "prototyping" / "subsets"
SYNTH = Path(__file__).resolve().parents[1] / "synth"
sys.path.insert(0, str(SYNTH))

API = "https://klassifikationer.socialstyrelsen.se/api/"
ICD_OID = "1.2.752.116.1.1.1"
ICD_NS = "8000301"
KKÅ_OID = "1.2.752.116.1.3.2.3.6"
KMÅ_OID = "1.2.752.116.1.3.2.3.5"
KKÅ_NS = "8000293"
KMÅ_NS = "8000297"
KVA_XLSX = (
    "https://www.ehalsomyndigheten.se/siteassets/ehm/2_verksamhet/ndi/"
    "interoperabilitet/klassifikationer/kva/kva-inkl-beskrivningstexter-2026.xlsx"
)

UA = {"User-Agent": "TermViz-V8-subset-builder/1.0 (demo subset only)", "Accept": "application/json"}


def http_json(path, params=None, timeout=60):
    q = urllib.parse.urlencode(params or {})
    url = API + path + ("?" + q if q else "")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def load_ontology_codes():
    raw = LIB.read_text()
    i = raw.index("{")
    d = json.loads(raw[i:].rstrip().rstrip(";"))
    codes = {"icd10": set(), "atc": set(), "npu": set(), "kva": set()}
    for n in d.get("ont", {}).get("nodes", []):
        sys = n.get("sys")
        if sys in codes and n.get("code"):
            codes[sys].add(n["code"])
    for e in d.get("ont", {}).get("edges", []):
        for id_ in e:
            if ":" not in id_:
                continue
            s, c = id_.split(":", 1)
            if s in codes:
                codes[s].add(c)
    return codes


def icd_pool_closure(want):
    from pool import ICD

    need = set(want)
    for c in list(need):
        cur = c
        while cur in ICD:
            p = ICD[cur][0]
            need.add(p)
            cur = p
    return need


def icd_search_title(code):
    try:
        d = http_json("Search/SimpleSearchSeparate", {"searchText": code, "namespaceId": ICD_NS})
    except Exception:
        return None
    for row in d.get("SearchResult") or []:
        if row.get("ConceptCode") == code:
            return row.get("Term")
    return None


def icd_properties_title(code):
    try:
        d = http_json(
            "Properties/GetConceptPropertiesByConceptCodeAsync",
            {
                "Oid": ICD_OID,
                "ConceptCode": code,
                "Name": "ICD-10-SE",
                "Classification": "ICD-10-SE",
                "Expandable": "false",
                "Manifestation": "false",
                "Level": "4",
            },
        )
        return d.get("Name")
    except Exception:
        return None


def fetch_icd10_se(want):
    from pool import ICD

    closure = icd_pool_closure(want)
    codes = {}
    for c in sorted(closure):
        title = icd_search_title(c) or icd_properties_title(c)
        if not title and c in ICD:
            title = ICD[c][1]  # pool sv label
        if not title:
            title = c
        parent = ICD[c][0] if c in ICD else None
        codes[c] = {"title": title, "parents": [parent] if parent else []}
    return {
        "source": "klassifikationer.socialstyrelsen.se/api (ICD-10-SE)",
        "oid": ICD_OID,
        "namespaceId": ICD_NS,
        "version": str(date.today()),
        "licence": "Socialstyrelsen ICD-10-SE — official API labels; demo hierarchy edges from V8 pool.",
        "codes": codes,
    }, None


def kva_search(code_or_text, namespace_id):
    try:
        return http_json(
            "Search/SimpleSearchSeparate",
            {"searchText": code_or_text, "namespaceId": namespace_id},
        )
    except Exception:
        return {"SearchResult": []}


def kva_code_ancestors(code):
    """KVÅ/KKÅ/KMÅ: parent codes by chopping two chars (5→3→1…)."""
    out = []
    c = code
    while len(c) > 1:
        c = c[:-2] if len(c) > 3 else c[:-1]
        if c:
            out.append(c)
    return out


def procedure_kva_codes():
    """Map demo procedure labels to KVÅ via Socialstyrelsen search (+ xlsx titles)."""
    from pool import PROC

    found = {}
    for key, row in PROC.items():
        psv = row[1]
        best = None
        for ns, oid_name in ((KKÅ_NS, "KKÅ"), (KMÅ_NS, "KMÅ")):
            d = kva_search(psv, ns)
            for hit in d.get("SearchResult") or []:
                term = (hit.get("Term") or "").strip()
                code = hit.get("ConceptCode") or ""
                if not code:
                    continue
                score = 0
                if term.lower() == psv.lower():
                    score = 100
                elif psv.lower() in term.lower():
                    score = 50
                elif term.lower() in psv.lower():
                    score = 30
                if score and (best is None or score > best[0] or (score == best[0] and len(code) < len(best[1]))):
                    best = (score, code, term, oid_name)
        if best:
            found[best[1]] = {"title": best[2], "kind": best[3], "proc": key}
    return found


def load_kva_xlsx_titles(codes_needed):
    try:
        from openpyxl import load_workbook

        req = urllib.request.Request(KVA_XLSX, headers=UA)
        data = urllib.request.urlopen(req, timeout=180).read()
        wb = load_workbook(io.BytesIO(data), read_only=True)
        ws = wb["KVÅ – (KKÅ+KMÅ)"]
        titles = {}
        need = set(codes_needed)
        for row in ws.iter_rows(min_row=2, values_only=True):
            if not row or not row[1]:
                continue
            code = str(row[1]).strip()
            if code in need:
                titles[code] = str(row[2]).strip() if row[2] else code
        return titles, "ehalsomyndigheten.se KVÅ 2026 xlsx (5-char level)"
    except Exception as e:
        return {}, str(e)


def fetch_kva(want_extra=None):
    proc = procedure_kva_codes()
    codes_needed = set(want_extra or [])
    codes_needed |= set(proc.keys())
    for c in list(codes_needed):
        codes_needed |= set(kva_code_ancestors(c))
    xlsx_titles, xlsx_note = load_kva_xlsx_titles(codes_needed)
    codes = {}
    for c in sorted(codes_needed):
        title = xlsx_titles.get(c)
        if not title:
            for ns in (KKÅ_NS, KMÅ_NS):
                d = kva_search(c, ns)
                for hit in d.get("SearchResult") or []:
                    if hit.get("ConceptCode") == c:
                        title = hit.get("Term")
                        break
                if title:
                    break
        if not title and c in proc:
            title = proc[c]["title"]
        if not title:
            title = c
        parents = kva_code_ancestors(c)
        codes[c] = {"title": title, "parents": parents[:1] if parents else []}
    return {
        "source": "Socialstyrelsen KVÅ API + EHM KVÅ 2026 xlsx (subset)",
        "oids": {"KKÅ": KKÅ_OID, "KMÅ": KMÅ_OID},
        "version": "2026-01-01",
        "licence": "KVÅ/KKÅ/KMÅ — EHM/Socialstyrelsen; subset only, not full redistribution.",
        "xlsx": xlsx_note,
        "procedureMap": {v["proc"]: k for k, v in proc.items()},
        "codes": codes,
    }, None


def fetch_atc_sv(want):
    url = "https://nsl.mpa.se/sensl-v2.0.zip"
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=120) as r:
            z = zipfile.ZipFile(io.BytesIO(r.read()))
        xml = z.read("codesystems/atc-code.xml").decode("utf-8", errors="replace")
    except Exception as e:
        return None, str(e)
    titles = {}
    for m in re.finditer(r'code="([A-Z0-9]+)"[^>]*(?:display|namn)="([^"]+)"', xml, re.I):
        titles[m.group(1)] = m.group(2)
    codes = {}
    closure = set(want)
    for c in want:
        while c:
            closure.add(c)
            c = c[:-1] if len(c) > 1 else ""
    for c in sorted(closure):
        if c in titles:
            p = c[:-1] if len(c) > 1 and c[:-1] in titles else None
            codes[c] = {"title": titles[c], "parents": [p] if p else []}
    return {
        "source": "Läkemedelsverket NSL sensl-v2.0",
        "licence": "WHOCC ATC — Swedish names via NSL",
        "codes": codes,
    }, None


def subset_npu(want):
    try:
        from pool import NPU as POOL_NPU
    except Exception:
        POOL_NPU = {}
    codes = {}
    for c in want:
        codes[c] = {"title": POOL_NPU[c][0] if c in POOL_NPU else c, "parents": []}
    return {
        "source": "Equalis NPU_Master (optional local) + demo pool",
        "licence": "NPU names för lokalt bruk where not from API",
        "codes": codes,
    }, None


def main():
    if not LIB.exists():
        print("Missing", LIB, "— run extract-libs.py first", file=sys.stderr)
        sys.exit(1)
    OUT.mkdir(parents=True, exist_ok=True)
    codes = load_ontology_codes()
    report = {}
    builders = [
        ("v8-icd10-se.json", sorted(codes["icd10"]), fetch_icd10_se),
        ("v8-kva-sv.json", sorted(codes["kva"]), lambda w: fetch_kva(w)),
        ("v8-atc-sv.json", sorted(codes["atc"]), fetch_atc_sv),
        ("v8-npu-sv.json", sorted(codes["npu"]), subset_npu),
    ]
    for name, want, builder in builders:
        body, err = builder(want)
        if body:
            (OUT / name).write_text(json.dumps(body, ensure_ascii=False, indent=2))
            report[name] = {"ok": True, "codes": len(body.get("codes", {}))}
            if name == "v8-icd10-se.json":
                for probe in ("S52.1", "N40", "N18.9", "K21.9", "G47.3"):
                    report.setdefault("probes", {})[probe] = body["codes"].get(probe, {}).get("title")
        else:
            report[name] = {"ok": False, "error": err}
            print("skip", name, err, file=sys.stderr)
    (OUT / "build-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()