import json, sys, urllib.request, urllib.parse
B="https://tx-nordics.fhir.org/fhir/r4/ValueSet/$expand"
def ex(term, ecl=None, n=8):
    url="http://snomed.info/sct/45991000052106?fhir_vs"+(("=ecl/"+urllib.parse.quote(ecl)) if ecl else "")
    q=urllib.parse.urlencode([("url",url),("filter",term),("count",n),("displayLanguage","sv"),("_format","json")])
    d=json.load(urllib.request.urlopen(urllib.request.Request(B+"?"+q,headers={"Accept":"application/fhir+json"}),timeout=40))
    return [(c["code"],c.get("display")) for c in d.get("expansion",{}).get("contains",[])]
if __name__=="__main__":
    ecl=sys.argv[1] if sys.argv[1]!="-" else None
    for t in sys.argv[2:]: print(t,'->',ex(t,ecl))
