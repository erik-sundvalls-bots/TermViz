#!/usr/bin/env python3
"""Build minimal Swedish terminology subsets for the V8 demo (codes used + ancestors only).
Writes JSON to public/prototyping/subsets/. Full source files are not committed."""
import json, re, sys, urllib.request, urllib.parse, zipfile, io
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]  # TermViz repo root
LIB = Path(__file__).resolve().parents[2] / "lib" / "v8-data.js"
OUT = ROOT / "public" / "prototyping" / "subsets"
OUT.mkdir(parents=True, exist_ok=True)


def load_ontology_codes():
    raw = LIB.read_text()
    i = raw.index("{")
    d = json.loads(raw[i:].rstrip().rstrip(";"))
    codes = {"icd10": set(), "atc": set(), "npu": set()}
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


def ancestors(table, code):
    seen = set()
    while code and code in table and code not in seen:
        seen.add(code)
        code = table[code].get("parent")
    return sorted(seen)


def fetch_icd10_se(want):
  url = "https://klassifikationer.socialstyrelsen.se/api/ICD10SE"
  try:
    with urllib.request.urlopen(url, timeout=60) as r:
      data = json.load(r)
  except Exception as e:
    return None, str(e)
  by_code = {}
  for row in data if isinstance(data, list) else data.get("codes", []):
    c = row.get("code") or row.get("kod")
    if not c:
      continue
    by_code[c] = {"title": row.get("title") or row.get("beskrivning") or row.get("namn"), "parent": row.get("parent") or row.get("overordnadKod")}
  codes = {}
  for c in want:
    if c in by_code:
      codes[c] = {"title": by_code[c]["title"], "parents": [by_code[c]["parent"]] if by_code[c].get("parent") else []}
    for a in ancestors(by_code, c):
      if a in by_code:
        codes.setdefault(a, {"title": by_code[a]["title"], "parents": [by_code[a]["parent"]] if by_code[a].get("parent") else []})
  return {
    "source": "Socialstyrelsen ICD-10-SE API",
    "oid": "1.2.752.116.1.1.1",
    "licence": "Socialstyrelsen klassifikationer — check current terms at klassifikationer.socialstyrelsen.se",
    "codes": codes,
  }, None


def fetch_atc_sv(want):
  url = "https://nsl.mpa.se/sensl-v2.0.zip"
  try:
    with urllib.request.urlopen(url, timeout=120) as r:
      z = zipfile.ZipFile(io.BytesIO(r.read()))
    xml = z.read("codesystems/atc-code.xml").decode("utf-8", errors="replace")
  except Exception as e:
    return None, str(e)
  titles = {}
  for m in re.finditer(r'code="([A-Z0-9]+)"[^>]*(?:display|namn)="([^"]+)"', xml, re.I):
    titles[m.group(1)] = m.group(2)
  for m in re.finditer(r"<ATC[^>]*>\s*<code[^>]*>([^<]+)</code>\s*<(?:name|display)[^>]*>([^<]+)", xml, re.I):
    titles.setdefault(m.group(1).strip(), m.group(2).strip())
  codes = {c: {"title": titles[c], "parents": [c[:i] for i in range(len(c), 0, -1) if c[:i] in titles and c[:i] != c][:1]} for c in want if c in titles}
  return {
    "source": "Läkemedelsverket NSL sensl-v2.0 (atc-code.xml)",
    "licence": "WHOCC ATC — Swedish names via NSL; do not redistribute modified WHOCC material",
    "codes": codes,
  }, None


def subset_npu(want):
  # Pool labels + any optional local Equalis file path
  sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "synth"))
  try:
    from pool import NPU as POOL_NPU
  except Exception:
    POOL_NPU = {}
  local = Path(__file__).parent / "npu-master.local.xlsx"
  codes = {}
  for c in want:
    if c in POOL_NPU:
      codes[c] = {"title": POOL_NPU[c][0], "parents": []}
    else:
      codes[c] = {"title": c, "parents": []}
  note = "NPU English from tx-nordics; Swedish names from demo pool or optional local Equalis NPU_Master xlsx (för lokalt bruk)"
  if local.exists():
    note += f"; local file present: {local.name}"
  return {"source": "Equalis NPU_Master (optional local) + demo pool", "licence": note, "codes": codes}, None


def main():
  codes = load_ontology_codes()
  report = {}
  for name, want, builder in [
    ("v8-icd10-se.json", codes["icd10"], fetch_icd10_se),
    ("v8-atc-sv.json", codes["atc"], fetch_atc_sv),
    ("v8-npu-sv.json", codes["npu"], subset_npu),
  ]:
    body, err = builder(sorted(want))
    if body:
      (OUT / name).write_text(json.dumps(body, ensure_ascii=False, indent=2))
      report[name] = {"ok": True, "codes": len(body.get("codes", {}))}
    else:
      report[name] = {"ok": False, "error": err}
      print("skip", name, err, file=sys.stderr)
  (OUT / "build-report.json").write_text(json.dumps(report, indent=2))
  print(json.dumps(report, indent=2))


if __name__ == "__main__":
  main()