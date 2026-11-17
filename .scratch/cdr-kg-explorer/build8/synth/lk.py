import json, os, sys, urllib.request, urllib.parse, concurrent.futures as cf
BASE="https://tx-nordics.fhir.org/fhir/r4/CodeSystem/$lookup"; SE="http://snomed.info/sct/45991000052106"; INTL="http://snomed.info/sct/900000000000207008"
def lookup(code, ver=SE, lang="sv"):
    q=urllib.parse.urlencode([("system","http://snomed.info/sct"),("version",ver),("code",code),("property","parent"),("property","inactive"),("displayLanguage",lang),("_format","json")])
    try: d=json.load(urllib.request.urlopen(urllib.request.Request(BASE+"?"+q,headers={"Accept":"application/fhir+json"}),timeout=40))
    except Exception as e: return code,{"err":str(e)}
    r={"sv":None,"parents":[],"inactive":None}
    for p in d.get("parameter",[]):
        if p["name"]=="display": r["sv"]=p.get("valueString")
        if p["name"]=="version": r["version"]=p.get("valueString")
        if p["name"]=="property":
            pp={x["name"]:x for x in p["part"]}; k=pp["code"].get("valueCode")
            if k=="parent": r["parents"].append(pp["value"].get("valueCode"))
            if k=="inactive": r["inactive"]=pp["value"].get("valueBoolean")
    return code,r
def en(code):
    for v in (INTL,SE):
        c,r=lookup(code,v,"en")
        if r.get("sv"): return r["sv"]
if __name__=="__main__":
    codes=sys.argv[1:]
    with cf.ThreadPoolExecutor(8) as ex:
        res=list(ex.map(lookup,codes)); ens=list(ex.map(en,codes))
    for (c,r),e in zip(res,ens): print(c, '|', r.get('sv'), '|', e, '| inactive' if r.get('inactive') else '', r.get('err',''))
