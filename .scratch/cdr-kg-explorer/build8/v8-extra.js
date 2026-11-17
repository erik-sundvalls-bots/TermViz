// ===== V8 i18n, settings, DAG subset, uploads, FHIR =====
const V8SRC = window.V8;
let D = structuredClone(V8SRC);
const DEFAULTS = { lang: "sv", anim: "system", txUrl: "https://tx-nordics.fhir.org/fhir/r4" };
const SETTINGS_KEY = "cdr-v8-settings";
const I18N = {
  sv: {
    title: "CDR KG-utforskare · V8 flerspråkig hopfällbar trestegsstack (interaktiv demo)",
    h1: "V8 · Flerspråkig hopfällbar trestegsstack: klustring i terminologi-DAG · arketyper över mallar · innehållsanpassade kaskad-treemaps för instanser",
    sub: "Topp (låst): Sugiyama-DAG per kodsystem; mellanliggande SNOMED CT-begrepp grupperas i kluster (<b>+n</b> = dolda begrepp; klicka för att expandera). Klicka den färgade bakgrunden i ett expanderat kluster, inte en nod eller en båge, för att fälla ihop det igen; en dragning gör det inte. Etiketter visas vid hovring. Mitten: klicka en arketyp eller mall för att öppna den som en treemap över dess noder och element (från IPS OPT, CKM 1013.26.376). Botten: klicka ett kort för att krympa en patient, komposition eller ett delträd till en blob. Ihopfällda saker får buntade länkar med antal; expanderade saker delar upp dem i streckade elementlänkar. Stora layoutändringar (kluster, treemap, filter, språk) animeras så att du kan följa det som flyttas.",
    ex: "EXEMPELDATA · fiktiva patienter (Eva Holmgren, Lars Nyström), rimliga värden<br>”*” = påhittat möte/mall · ”Syntetisk nn” = syntetiska patienter",
    patients: "Patienter:", both: "Båda", syn: "+ 30 syntetiska patienter",
    collapseAll: "Fäll ihop allt", expandInst: "Expandera alla instanser",
    lbl: "Visa mellanliggande etiketter", cascade: "Kaskadavstånd",
    legend: "<b>━ n</b> buntade länkar (antal) · <b>┄</b> elementlänk mellan expanderade noder · skrafferad ruta = värde kodat med en terminologi · hovra för att spåra sökvägen · färgad klusterbakgrund: klicka tom yta för att fälla ihop",
    settings: "Inställningar", settingsTitle: "Inställningar",
    language: "Språk", animations: "Animationer",
    animSystem: "Följ systemet (standard)", animOn: "Alltid på", animOff: "Av",
    sysReduceOn: "System: reducerad rörelse är PÅ", sysReduceOff: "System: reducerad rörelse är AV",
    txUrl: "FHIR-terminologiserver (URL)", txOk: "Ansluten", txOffline: "Offline — använder cache", txErr: "Fel", txIdle: "Används för $lookup när en kod saknas i cachen",
    uploads: "Uppladdade filer",
    upArch: "Arketyper (.adl, JSON)",
    upTpl: "Mallar (.opt XML, webbmall-JSON)",
    upInst: "Instansdata (en mapp per patient)",
    upDirHint: "Dela upp patientdata i separata mappar, en per patient. Mappnamnet blir patientens etikett. Sammansättningsfiler kan vara kanonisk JSON/XML eller FLAT JSON.",
    upStoreHint: "Filerna sparas i webbläsaren (IndexedDB; localStorage räcker inte över ca 5 MB).",
    resetField: "Återställ till standard", resetAll: "Återställ allt till fabriksinställningar",
    resetConfirm: "Återställa alla inställningar och ta bort sparade uppladdningar?",
    noFiles: "Inga filer uppladdade ännu.",
    loadedAs: "inläst som",
    parseFail: "kunde inte tolkas",
    clickCollapseHull: "Klicka bakgrunden för att fälla ihop detta kluster",
    invented: "påhittad mall, byggd av IPS-delar",
    synthetic: "syntetisk",
    collapsedLinks: " — ihopfälld; länkarna är buntade. Klicka för att expandera.",
    clickShrink: " — klicka för att krympa till en blob",
    clickShrinkParent: "Klicka: krymp föräldrakortet",
    clickOpen: "Klicka för att öppna som treemap",
    clickCollapse: "Klicka för att fälla ihop",
    clusterOf: "Kluster med",
    interConcepts: "mellanliggande SNOMED CT-begrepp",
    clickExpand: "Klicka för att expandera",
    expCluster: "Expanderat kluster med",
    interConcepts2: "mellanliggande begrepp",
    clickBg: "Klicka bakgrunden för att fälla ihop. En dragning gör det inte.",
    memberOf: " · medlem i ett expanderat kluster (klicka noden eller den färgade bakgrunden för att fälla ihop)",
    instCoded: "instanselement kodade här eller under",
    elements: "element",
    codedAs: "Kodad som",
    boundTo: "Bunden till",
    termBindings: "Terminologibindningar",
    none: "inga",
    parents: "förälder", parents2: "föräldrar",
    tmplOcc: "mallförekomst(er)",
    elementsInUse: "element som används av mallarna",
    archOcc: "arketypförekomster",
    labArch: "ARKETYPER (återanvändbara, designtid) · klicka för att öppna som treemap",
    labTpl: "MALLAR (varje mall använder flera arketyper) · klicka för att öppna",
    labBot: "PATIENTDATA · innehållsanpassade kaskad-treemaps · klicka ett kort för att krympa det till en blob",
    upBusy: "Tolkar filer…",
    upBusyReload: "Läser in sparade filer…",
    flatIssues: "varningar"
  },
  en: {
    title: "CDR KG explorer · V8 multilingual collapsible three-layer stack (interactive demo)",
    h1: "V8 · Multilingual collapsible three-layer stack: clustered ontology DAG · archetypes over templates · content-sized cascaded instance treemaps",
    sub: "Top (locked): Sugiyama DAG per code system; intermediate SNOMED CT concepts are grouped into clusters (<b>+n</b> = hidden concepts; click to expand). Click the coloured background of an expanded cluster, not a node or an edge, to collapse it again; a drag does not. Labels show on hover. Middle: click an archetype or template to open it as a treemap of its nodes and elements (from the IPS OPT, CKM 1013.26.376). Bottom: click any card to shrink a patient, composition or subtree to a blob. Collapsed things get bundled links with counts; expanded things split them into dotted element-level links. Big layout changes (cluster or treemap expand/collapse, filters, language) animate so you can follow what moved.",
    ex: "EXAMPLE DATA · fictitious patients (Eva Holmgren, Lars Nyström), plausible values<br>“*” = invented encounter/template · “Synthetic nn” = synthetic patients",
    patients: "Patients:", both: "Both", syn: "+ 30 synthetic patients",
    collapseAll: "Collapse everything", expandInst: "Expand all instances",
    lbl: "Show intermediate labels", cascade: "Cascade offset",
    legend: "<b>━ n</b> bundled links (count) · <b>┄</b> element-level link between expanded nodes · hatched tile = value coded with a terminology · hover anything to trace its path · coloured cluster background: click empty space to collapse",
    settings: "Settings", settingsTitle: "Settings",
    language: "Language", animations: "Animations",
    animSystem: "Follow system (default)", animOn: "Always on", animOff: "Off",
    sysReduceOn: "System: reduce motion is ON", sysReduceOff: "System: reduce motion is OFF",
    txUrl: "FHIR terminology server URL", txOk: "Connected", txOffline: "Offline — using cache", txErr: "Error", txIdle: "Used for $lookup when a code is missing from the cache",
    uploads: "Uploaded files",
    upArch: "Archetypes (.adl, JSON)",
    upTpl: "Templates (.opt XML, web template JSON)",
    upInst: "Instance data (one folder per patient)",
    upDirHint: "Split patient data into separate directories, one per patient. The directory name becomes the patient label. Composition files may be canonical JSON/XML or FLAT JSON.",
    upStoreHint: "Files are stored in this browser (IndexedDB; localStorage is only about 5 MB).",
    resetField: "Reset to default", resetAll: "Reset all to factory settings",
    resetConfirm: "Reset all settings and clear stored uploads?",
    noFiles: "No files uploaded yet.",
    loadedAs: "loaded as",
    parseFail: "could not be parsed",
    clickCollapseHull: "Click the background to collapse this cluster",
    invented: "invented template, built from IPS parts",
    synthetic: "synthetic",
    collapsedLinks: " — collapsed; links are bundled. Click to expand.",
    clickShrink: " — click to shrink to a blob",
    clickShrinkParent: "Click: shrink the parent card",
    clickOpen: "Click to open as treemap",
    clickCollapse: "Click to collapse",
    clusterOf: "Cluster of",
    interConcepts: "intermediate SNOMED CT concepts",
    clickExpand: "Click to expand",
    expCluster: "Expanded cluster of",
    interConcepts2: "intermediate concepts",
    clickBg: "Click the background to collapse. A drag does not.",
    memberOf: " · member of an expanded cluster (click the node or the coloured background to collapse it)",
    instCoded: "instance element(s) coded at or below",
    elements: "element(s)",
    codedAs: "Coded as",
    boundTo: "Bound to",
    termBindings: "Term bindings",
    none: "none",
    parents: "parent", parents2: "parents",
    tmplOcc: "template occurrence(s)",
    elementsInUse: "elements in use by the templates",
    archOcc: "archetype occurrences",
    labArch: "ARCHETYPES (reusable, design time) · click to open as treemap",
    labTpl: "TEMPLATES (each uses many archetypes) · click to open",
    labBot: "PATIENT DATA · content-sized cascaded treemaps · click a card to shrink it to a blob",
    upBusy: "Parsing files…",
    upBusyReload: "Reloading stored files…",
    flatIssues: "warnings"
  }
};
function T(k) { const p = I18N[S.lang] || I18N.sv; return (p && p[k]) || I18N.en[k] || k; }
function loc(x) {
  if (x == null) return "";
  if (typeof x === "string" || typeof x === "number") return String(x);
  if (typeof x === "object") return x[S.lang] || x.sv || x.en || "";
  return String(x);
}
function ontLab(n) { return n ? (n[S.lang] || n.sv || n.en || n.code || n.id || "") : ""; }
function applyI18n() {
  document.documentElement.lang = S.lang;
  document.title = T("title");
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.innerHTML = T(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.setAttribute("title", T(el.dataset.i18nTitle)); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.setAttribute("placeholder", T(el.dataset.i18nPlaceholder)); });
  d3.selectAll("[data-lang]").classed("on", function () { return this.dataset.lang === S.lang; });
  idbAll().then(refreshFileList).catch(() => {}); if (typeof refreshPatientButtons === "function") refreshPatientButtons();
  const sys = document.getElementById("sysMotion");
  if (sys) sys.textContent = systemReduce() ? T("sysReduceOn") : T("sysReduceOff");
  const idle = document.getElementById("txIdle");
  if (idle && !txLastStatus) idle.textContent = T("txIdle");
}

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {}; } catch (e) { saved = {}; }
  const url = new URLSearchParams(location.search);
  const lang = (url.get("lang") === "en" || url.get("lang") === "sv") ? url.get("lang") : (saved.lang || DEFAULTS.lang);
  const anim = ["system", "on", "off"].includes(saved.anim) ? saved.anim : DEFAULTS.anim;
  const txUrl = (typeof saved.txUrl === "string" && saved.txUrl.trim()) ? saved.txUrl.trim() : DEFAULTS.txUrl;
  return { lang, anim, txUrl };
}
function persistSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ lang: S.lang, anim: S.anim, txUrl: S.txUrl })); } catch (e) {}
  const url = new URL(location.href);
  url.searchParams.set("lang", S.lang);
  history.replaceState(null, "", url);
}
function setLang(lang, rerender) {
  S.lang = lang === "en" ? "en" : "sv";
  persistSettings();
  applyI18n();
  if (rerender !== false) render();
}

const systemReduce = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
const reduceMotion = () => S.anim === "off" ? true : S.anim === "on" ? false : systemReduce();

// ----- runtime ontology subset (port of sct7.py keep + clusters, per selected patients) -----
let ONTKEEP = new Set(), ONTCLOF = new Map(), ONTCLUSTERS = [];
function namespaceCl(sys, cid) {
  if (!cid) return null;
  const s = String(cid);
  if (s.startsWith(sys + ":")) return s;
  if (/^(sct|icd10|atc|npu):/i.test(s)) return s;
  return sys + ":" + s;
}
function liveCl(id) {
  if (id && ONTCLOF.has(id)) return ONTCLOF.get(id);
  const n = ONT.get(id);
  if (!n || !n.cluster) return null;
  return namespaceCl(n.sys, n.cluster);
}
function recomputeVisibleOnt(usedSet) {
  ONTKEEP = new Set();
  ONTCLOF = new Map();
  const clusters = [];
  const systems = ["sct", "icd10", "atc", "npu"];
  for (const sys of systems) {
    const used = [...usedSet].filter((id) => ONT.get(id)?.sys === sys);
    if (!used.length) continue;
    const CL = new Set(used);
    for (const u of used) for (const a of ancestors(u)) if (ONT.get(a)?.sys === sys) CL.add(a);
    const kids = new Map();
    for (const id of CL) kids.set(id, []);
    for (const id of CL) for (const p of (ONT.get(id)?.parents || [])) if (CL.has(p)) kids.get(p).push(id);
    const ud = new Map();
    const usedIn = new Set(used);
    const usedDesc = (id) => {
      if (ud.has(id)) return ud.get(id);
      const s = new Set();
      if (usedIn.has(id)) s.add(id);
      for (const k of kids.get(id) || []) for (const x of usedDesc(k)) s.add(x);
      ud.set(id, s);
      return s;
    };
    for (const id of CL) usedDesc(id);
    const sigOf = (s) => [...s].sort().join("\t");
    const sysKeep = new Set(used);
    const roots = [...CL].filter((id) => !(ONT.get(id).parents || []).some((p) => CL.has(p)));
    roots.forEach((r) => sysKeep.add(r));
    for (const id of CL) if ((ONT.get(id).parents || []).some((p) => roots.includes(p))) sysKeep.add(id);
    for (const id of CL) {
      if (sysKeep.has(id)) continue;
      const ch = kids.get(id) || [];
      if (ch.length >= 2 && ch.every((k) => sigOf(usedDesc(k)) !== sigOf(usedDesc(id)))) sysKeep.add(id);
    }
    const rest = [...CL].filter((id) => !sysKeep.has(id));
    const byOrig = new Map();
    for (const id of rest) {
      const oc = namespaceCl(sys, ONT.get(id)?.cluster);
      if (oc) (byOrig.get(oc) || byOrig.set(oc, []).get(oc)).push(id);
    }
    const assigned = new Set();
    for (const [cid, mem] of byOrig) {
      if (mem.length < 2) continue;
      clusters.push({ id: cid, sys, members: mem.slice() });
      mem.forEach((m) => { ONTCLOF.set(m, cid); assigned.add(m); });
    }
    const leftover = rest.filter((id) => !assigned.has(id));
    const kdMemo = new Map();
    const kd = (id) => {
      if (kdMemo.has(id)) return kdMemo.get(id);
      const r = new Set();
      for (const k of kids.get(id) || []) {
        if (sysKeep.has(k)) r.add(k);
        else for (const x of kd(k)) r.add(x);
      }
      kdMemo.set(id, r);
      return r;
    };
    const sig = {};
    leftover.forEach((id) => { sig[id] = sigOf(kd(id)); });
    const comp = new Map();
    let nNew = 0;
    for (const c of leftover) {
      if (comp.has(c)) continue;
      const cid = `${sys}:r${++nNew}`;
      const st = [c];
      comp.set(c, cid);
      while (st.length) {
        const x = st.pop();
        for (const y of [...(ONT.get(x)?.parents || []), ...(kids.get(x) || [])]) {
          if (leftover.includes(y) && !comp.has(y) && sig[y] === sig[c]) { comp.set(y, cid); st.push(y); }
        }
      }
    }
    const groups = new Map();
    for (const [id, cid] of comp) (groups.get(cid) || groups.set(cid, []).get(cid)).push(id);
    for (const [cid, mem] of groups) {
      if (mem.length === 1) sysKeep.add(mem[0]);
      else {
        clusters.push({ id: cid, sys, members: mem });
        mem.forEach((m) => ONTCLOF.set(m, cid));
      }
    }
    sysKeep.forEach((id) => ONTKEEP.add(id));
  }
  ONTCLUSTERS = clusters;
  return clusters;
}

// ----- IndexedDB uploads -----
const IDB_NAME = "cdr-v8-uploads", IDB_STORE = "files";
let txLastStatus = "";
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbAll() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const r = tx.objectStore(IDB_STORE).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}
async function idbPut(rec) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbDel(id) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbClear() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const SYS_URI = { sct: "http://snomed.info/sct", icd10: "http://hl7.org/fhir/sid/icd-10", atc: "http://www.whocc.no/atc", npu: "http://npu-terminology.org" };
const URI_SYS = Object.fromEntries(Object.entries(SYS_URI).map(([k, v]) => [v, k]));
function splitOntId(id) {
  const i = id.indexOf(":");
  return i < 0 ? { sys: "sct", code: id } : { sys: id.slice(0, i), code: id.slice(i + 1) };
}
async function txLookup(sys, code) {
  const base = (S.txUrl || DEFAULTS.txUrl).replace(/\/$/, "");
  const uri = SYS_URI[sys] || sys;
  const lang = S.lang === "en" ? "en" : "sv";
  const q = new URLSearchParams({ system: uri, code, property: "parent", displayLanguage: lang, _format: "json" });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${base}/CodeSystem/$lookup?${q}`, { headers: { Accept: "application/fhir+json" }, signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const d = await res.json();
    const r = { sv: null, en: null, parents: [], inactive: false };
    for (const p of d.parameter || []) {
      if (p.name === "display") { if (lang === "sv") r.sv = p.valueString; else r.en = p.valueString; }
      if (p.name === "property") {
        const pp = {};
        for (const x of p.part || []) pp[x.name] = x;
        const k = pp.code?.valueCode;
        if (k === "parent") r.parents.push(pp.value?.valueCode || pp.valueCode?.valueCode);
        if (k === "inactive") r.inactive = !!(pp.value?.valueBoolean);
      }
      if (p.name === "designation") {
        const pp = {};
        for (const x of p.part || []) pp[x.name] = x;
        const lc = pp.language?.valueCode || "";
        if (lc.startsWith("en")) r.en = r.en || pp.value?.valueString;
        if (lc.startsWith("sv")) r.sv = r.sv || pp.value?.valueString;
      }
    }
    txLastStatus = "ok";
    return r;
  } catch (e) {
    txLastStatus = (e && e.name === "AbortError") || (typeof navigator !== "undefined" && !navigator.onLine) ? "offline" : "err";
    throw e;
  } finally {
    clearTimeout(t);
    updateTxStatus();
  }
}
function updateTxStatus() {
  const el = document.getElementById("txStatus");
  if (!el) return;
  el.className = "tx-status " + (txLastStatus || "idle");
  el.textContent = txLastStatus === "ok" ? T("txOk") : txLastStatus === "offline" ? T("txOffline") : txLastStatus === "err" ? T("txErr") : T("txIdle");
}
async function ensureCodes(ids) {
  const missing = [...new Set(ids)].filter((id) => id && !ONT.has(id));
  if (!missing.length) return;
  for (const id of missing) {
    const { sys, code } = splitOntId(id);
    try {
      const front = [code];
      const seen = new Set();
      while (front.length) {
        const c = front.pop();
        if (seen.has(c)) continue;
        seen.add(c);
        const nid = sys + ":" + c;
        if (ONT.has(nid)) {
          for (const p of ONT.get(nid).parents || []) front.push(splitOntId(p).code);
          continue;
        }
        const r = await txLookup(sys, c);
        const rec = { id: nid, sys, code: c, sv: r.sv || r.en || c, en: r.en || r.sv || c, used: false, kept: true, cluster: null, inactive: !!r.inactive, parents: (r.parents || []).filter(Boolean).map((p) => sys + ":" + p), kids: [] };
        D.ont.nodes.push(rec);
        for (const p of rec.parents) { D.ont.edges.push([nid, p]); front.push(splitOntId(p).code); }
      }
    } catch (e) { console.warn("tx lookup failed", id, e); }
  }
  rebuildIndexes();
}

// ----- ehrtslib-backed file ingest -----
function ehr() { return window.EHRTSlib || {}; }
function extOf(name) { return (name.split(".").pop() || "").toLowerCase(); }
function looksLikeV8Instance(obj) {
  return obj && typeof obj === "object" && (obj.v8Instance || obj.k === "patient" || obj.k === "composition" || (Array.isArray(obj.children) && obj.name && (obj.k || obj.tpl)));
}
function isFlatPayload(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  if (obj._type || obj.content || obj.archetype_node_id || obj.archetypeNodeId) return false;
  const keys = Object.keys(obj);
  return keys.some((k) => k.includes("/") || k.includes("|") || k === "ctx" || k.startsWith("ctx/"));
}
function flatRootKey(flat) {
  for (const k of Object.keys(flat || {})) {
    if (k === "ctx" || k.startsWith("ctx/") || k.startsWith("ctx|")) continue;
    const root = k.split("/")[0].split("|")[0].trim();
    if (root) return root;
  }
  return "";
}
function normId(s) {
  const lib = ehr();
  if (!s) return "";
  if (lib.normalizeWebTemplateId) return lib.normalizeWebTemplateId(String(s));
  let id = String(s).trim().replace(/[^\p{L}\p{N}_.\-]+/gu, "_").replace(/_+/g, "_").toLowerCase().replace(/^_+|_+$/g, "");
  if (!id) id = "id";
  if (/^\d/.test(id)) id = "a" + id;
  return id;
}
function templateMatchIds(wt) {
  const ids = new Set();
  if (!wt) return ids;
  const add = (x) => { if (!x) return; const s = String(x); ids.add(s); ids.add(s.toLowerCase()); ids.add(normId(s)); };
  add(wt.templateId);
  if (ehr().templateRootId && wt.templateId) add(ehr().templateRootId(wt.templateId));
  const tree = wt.tree || {};
  add(tree.id);
  add(tree.nodeId);
  add(tree.archetypeId);
  add(tree.name);
  return ids;
}
function wtOfTemplate(t) {
  const lib = ehr();
  if (!t) return null;
  if (t._wt) return t._wt;
  if (t._wtJson && lib.parseWebTemplate) {
    try { t._wt = lib.parseWebTemplate(t._wtJson); return t._wt; } catch (e) { console.warn("parseWebTemplate", e); }
  }
  if (t._opt && lib.buildWebTemplate) {
    try { t._wt = lib.buildWebTemplate(t._opt, { languages: ["sv", "en"] }); return t._wt; } catch (e) { console.warn("buildWebTemplate", e); }
  }
  return null;
}
function attachWt(tpl, wt, rec) {
  if (!tpl || !wt) return tpl;
  tpl._wt = wt;
  try { tpl._wtJson = typeof wt === "string" ? wt : JSON.stringify(wt); } catch (e) { tpl._wtJson = null; }
  tpl.templateId = wt.templateId || tpl.templateId;
  tpl.rootArchetypeId = (wt.tree && (wt.tree.nodeId || wt.tree.archetypeId)) || tpl.rootArchetypeId;
  if (rec && tpl._wtJson) rec.wtJson = tpl._wtJson;
  return tpl;
}
function findWtForFlat(flat) {
  const root = normId(flatRootKey(flat));
  const raw = flatRootKey(flat);
  const scored = [];
  for (const t of D.templates || []) {
    const wt = wtOfTemplate(t);
    if (!wt) continue;
    const ids = templateMatchIds(wt);
    const hit = (root && (ids.has(root) || ids.has(raw) || ids.has(raw.toLowerCase()))) ||
      [...ids].some((id) => id && (id === root || normId(id) === root));
    if (hit) scored.push({ t, wt, n: 0 });
  }
  if (scored.length) return scored[0].wt;
  // last resort: first uploaded template that still has a web template
  for (const t of D.templates || []) {
    if (!t.uploaded) continue;
    const wt = wtOfTemplate(t);
    if (wt) return wt;
  }
  return null;
}
function rmNameOf(obj) {
  if (!obj || typeof obj !== "object") return "";
  const n = obj.name ?? obj.$name;
  if (n == null) return "";
  if (typeof n === "string") return n;
  if (typeof n.value === "string") return n.value;
  if (n.$value && typeof n.$value === "string") return n.$value;
  return loc(n) || "";
}
function rmCodeOf(defining) {
  if (!defining) return null;
  const term = defining.terminology_id?.value || defining.terminologyId?.value || defining.terminology_id || "";
  const code = defining.code_string || defining.codeString || defining.code || "";
  if (!code) return null;
  if (/^(at|ac)\d/i.test(String(code))) return null;
  const t = String(term);
  let sys = "sct";
  if (/icd-?10/i.test(t)) sys = "icd10";
  else if (/atc/i.test(t) || /whocc/i.test(t)) sys = "atc";
  else if (/npu/i.test(t)) sys = "npu";
  else if (/openehr/i.test(t) || /ISO_?639/i.test(t) || /ISO_?3166/i.test(t) || /IANA/i.test(t)) return null;
  else if (/sct|snomed/i.test(t) || t === "SNOMED-CT" || t === "") sys = "sct";
  return sys + ":" + code;
}
function collectCodesFromValue(val, acc) {
  if (!val || typeof val !== "object") return acc;
  const dc = val.defining_code || val.definingCode;
  const c = rmCodeOf(dc);
  if (c) acc.push(c);
  for (const m of val.mappings || val.term_mappings || []) {
    const mc = rmCodeOf(m.target || m);
    if (mc) acc.push(mc);
  }
  return acc;
}
function rmValueText(val) {
  if (val == null) return "";
  if (typeof val === "string" || typeof val === "number") return String(val);
  if (typeof val !== "object") return String(val);
  if (val.magnitude != null) return val.magnitude + (val.units ? " " + val.units : "");
  if (val.value != null && typeof val.value !== "object") return String(val.value);
  if (val.value && val.value.magnitude != null) return val.value.magnitude + (val.value.units ? " " + val.value.units : "");
  const dc = val.defining_code || val.definingCode;
  if (dc && (val.value == null)) return rmCodeOf(dc) || "";
  return rmNameOf(val) || "";
}
function asTypedRm(comp) {
  const lib = ehr();
  if (!comp || typeof comp !== "object" || !lib.toTypedRm) return comp;
  const proto = Object.getPrototypeOf(comp);
  const looksPlain = !proto || proto === Object.prototype || comp._type;
  if (!looksPlain && comp.constructor && /COMPOSITION|Evaluation|Observation/i.test(comp.constructor.name || "")) return comp;
  try { return lib.toTypedRm(comp); } catch (e) { return comp; }
}
const SKIP_RM_KEYS = new Set(["name", "value", "uid", "language", "territory", "encoding", "subject", "composer", "category", "archetype_details", "archetype_node_id", "feeder_audit", "rm_version", "links", "_type", "guid", "context"]);
const WALK_RM = /^(COMPOSITION|SECTION|ADMIN_ENTRY|CARE_ENTRY|OBSERVATION|EVALUATION|INSTRUCTION|ACTION|CLUSTER|ELEMENT|ITEM_TREE|ITEM_LIST|ITEM_SINGLE|ITEM_TABLE|ITEM_STRUCTURE|HISTORY|EVENT|POINT_EVENT|INTERVAL_EVENT|ACTIVITY|ISM_TRANSITION)$/i;
function rmTypeName(o) {
  const lib = ehr();
  if (lib.resolveRmTypeName) {
    try { const t = lib.resolveRmTypeName(o); if (t) return t; } catch (e) {}
  }
  return o._type || o.rmType || "";
}
function isWalkableRm(o) {
  if (!o || typeof o !== "object") return false;
  const t = rmTypeName(o);
  if (t && /^(DV_|CODE_PHRASE|PARTY_|ARCHETYPED|TEMPLATE_ID|TERMINOLOGY_ID|UID_BASED_ID|HIER_OBJECT_ID|OBJECT_REF|OBJECT_ID|LINK|PARTICIPATION|ATTESTATION|AUDIT_DETAILS|FEEDER_AUDIT|GENERIC_ID|INTERNET_ID|ISO_OID|UUID|LOCATABLE_REF)$/i.test(t)) return false;
  if (WALK_RM.test(t)) return true;
  if (o.content || o.items || o.data || o.events || o.activities || o.description) return true;
  if (o.archetype_node_id || o.archetypeNodeId) return true;
  if (o.value != null && o.name) return true;
  return false;
}
function rmPropNames(node) {
  const lib = ehr();
  if (lib.collectRmPropertyNames) {
    try { return lib.collectRmPropertyNames(node); } catch (e) { /* fall through */ }
  }
  return Object.keys(node || {}).filter((k) => !k.startsWith("_") && !k.startsWith("$"));
}
function walkRm(node, path, aid, acc, kHint) {
  if (!node || typeof node !== "object") return;
  const aidHere = node.archetype_details?.archetype_id?.value || node.archetypeDetails?.archetype_id?.value || (typeof node.archetype_node_id === "string" && node.archetype_node_id.startsWith("openEHR") ? node.archetype_node_id : aid);
  const at = node.archetype_node_id || node.archetypeNodeId || "";
  const name = rmNameOf(node) || at || aidHere || "node";
  const val = node.value;
  const codes = [];
  collectCodesFromValue(val, codes);
  collectCodesFromValue(node, codes);
  const rm = node._type || node.rmType || node.constructor?.name || "";
  const isComp = /COMPOSITION/i.test(rm);
  const isEl = val != null || /ELEMENT/i.test(rm);
  const rec = { id: path, k: isComp ? "composition" : isEl ? "element" : (/SECTION/i.test(rm) ? "section" : /CLUSTER/i.test(rm) ? "cluster" : "entry"), name, value: isEl ? rmValueText(val) : undefined, codes: codes.length ? [...new Set(codes)] : undefined, aid: aidHere, archEl: aidHere ? (aidHere + "|/" + (at || "")) : undefined, path, children: [] };
  if (kHint) rec.k = kHint;
  acc.push(rec);
  const keys = rmPropNames(node);
  for (const key of keys) {
    if (SKIP_RM_KEYS.has(key)) continue;
    const ch = node[key];
    if (ch == null || (typeof ch !== "object")) continue;
    const arr = Array.isArray(ch) ? ch : [ch];
    arr.forEach((c, i) => {
      if (!isWalkableRm(c)) return;
      walkRm(c, path + "/" + key + (arr.length > 1 ? "[" + i + "]" : ""), aidHere || aid, rec.children);
    });
  }
  return rec;
}
function inferTplForComposition(comp, tree, wt) {
  const aid = comp?.archetype_details?.archetype_id?.value || comp?.archetypeDetails?.archetype_id?.value || tree.aid;
  const name = rmNameOf(comp) || loc(tree.name);
  const cands = D.templates || [];
  const hit = (wt && cands.find((t) => t._wt === wt || (t.templateId && wt.templateId && t.templateId === wt.templateId)))
    || cands.find((t) => t.templateId && name && loc(t.name) === name)
    || cands.find((t) => t.rootArchetypeId && aid && String(aid).startsWith(String(t.rootArchetypeId)))
    || cands.find((t) => t.uploaded);
  if (hit) { tree.tpl = hit.id; tree.tnode = hit.tree && hit.tree.id; }
}
function compositionToPatient(comp, patientName, fileId, wt, flatIn) {
  const typed = asTypedRm(comp);
  const root = { children: [] };
  walkRm(typed, fileId + ":root", null, root.children, "composition");
  const tree = root.children[0] || { id: fileId + ":comp", k: "composition", name: rmNameOf(typed) || fileId, children: [] };
  tree.k = "composition";
  inferTplForComposition(typed, tree, wt);
  let flat = flatIn;
  const lib = ehr();
  if (!wt && tree.tpl) wt = wtOfTemplate((D.templates || []).find((t) => t.id === tree.tpl));
  if (!flat && wt && lib.serializeToFlat) {
    try { flat = lib.serializeToFlat(typed, wt); } catch (e) { flat = null; }
  }
  if (flat) mergeCodes(tree, codesFromFlat(flat));
  return { id: "up:" + fileId, k: "patient", name: patientName, uploaded: true, children: [tree] };
}
function addOrMergePatient(pat) {
  const key = patientKey(pat);
  const existing = (D.patients || []).find((p) => p.uploaded && patientKey(p) === key);
  if (existing) {
    existing.children = (existing.children || []).concat(pat.children || []);
    return existing;
  }
  D.patients.push(pat);
  return pat;
}
function collectTreeCodes(n, acc) {
  (n.codes || []).forEach((c) => acc.push(c));
  (n.children || []).forEach((c) => collectTreeCodes(c, acc));
  return acc;
}
function codesFromFlat(flat) {
  const codes = [];
  if (!flat || typeof flat !== "object") return codes;
  for (const [k, v] of Object.entries(flat)) {
    const i = k.lastIndexOf("|");
    if (i < 0 || k.slice(i + 1) !== "code") continue;
    const term = flat[k.slice(0, i) + "|terminology"] || "";
    const c = rmCodeOf({ terminology_id: { value: term }, code_string: String(v) });
    if (c) codes.push(c);
  }
  return [...new Set(codes)];
}
function mergeCodes(tree, codes) {
  if (!tree || !codes || !codes.length) return tree;
  const have = new Set(collectTreeCodes(tree, []));
  const extra = codes.filter((c) => !have.has(c));
  if (!extra.length) return tree;
  tree.codes = [...new Set((tree.codes || []).concat(extra))];
  return tree;
}
function webTemplateToOurs(wt, fileId) {
  const tid = "up-tpl:" + fileId;
  const walk = (n, path) => {
    const id = tid + "|" + (n.aqlPath || n.id || path);
    const locName = n.localizedNames ? { sv: n.localizedNames.sv || n.localizedName || n.name, en: n.localizedNames.en || n.localizedName || n.name } : (n.name || n.id);
    const rm = (n.rmType || "").toUpperCase();
    const k = /COMPOSITION/.test(rm) ? "template" : /ELEMENT/.test(rm) ? "element" : /SECTION/.test(rm) ? "section" : /CLUSTER/.test(rm) ? "cluster" : /ARCHETYPE|OBSERVATION|EVALUATION|ACTION|INSTRUCTION|ADMIN/.test(rm) ? "archetype" : "cluster";
    const node = { id, k, name: locName, rm, aid: (n.nodeId && String(n.nodeId).startsWith("openEHR") ? n.nodeId : undefined) || (n.archetypeId), children: (n.children || []).map((c, i) => walk(c, path + "/" + i)) };
    if (n.inputs && k === "element") node.vt = n.inputs.map((x) => x.type || x.suffix).filter(Boolean);
    return node;
  };
  const tree = walk(wt.tree || wt, "/");
  return { id: "up-tpl:" + fileId, name: wt.templateId || wt.name || fileId, short: wt.templateId || fileId, ckm: null, invented: false, uploaded: true, tree };
}
function archetypeToOurs(parsed, fileId) {
  const a = parsed.archetype || parsed.adlArchetype || parsed.object || parsed;
  const aid = a?.archetype_id?.value || a?.archetypeId?.value || a?.archetype_id || fileId;
  const code = a?.definition?.node_id || a?.concept || a?.concept_code || "id1";
  const lang = a?.original_language?.code_string || a?.original_language?.codeString || "en";
  const td = a?.ontology?.term_definitions || {};
  const textOf = (l) => td?.[l]?.[code]?.text || td?.[l]?.[code]?.value;
  const en = textOf("en") || textOf(lang);
  const sv = textOf("sv") || textOf(lang) || en;
  const label = (sv && en && sv !== en) ? { sv, en } : (sv || en || aid);
  const rm = (String(aid).split("-")[2] || "CLUSTER").split(".")[0];
  const tree = { id: aid + "|/", k: "archetype", name: label, aid, children: [] };
  return { id: aid, label, rm, tree, bindings: [], occurrences: [], uploaded: true, rawKind: "archetype" };
}

function setUploadBusy(on, msg) {
  const el = document.getElementById("upBusy");
  const m = document.getElementById("upBusyMsg");
  if (!el) return;
  if (on) { el.removeAttribute("hidden"); if (m) m.textContent = msg || T("upBusy"); }
  else el.setAttribute("hidden", "");
}

async function ingestText(rec) {
  const { name, text, kindHint, patient } = rec;
  const ext = extOf(name);
  const lib = ehr();
  if (lib.registerOpenEhrModelTypes) try { lib.registerOpenEhrModelTypes(); } catch (e) {}
  const out = { ok: false, kind: kindHint || "unknown", message: "", models: [] };
  const tryJson = () => { try { return JSON.parse(text); } catch (e) { return null; } };
  try {
    const jsonFirst = (ext === "json" || (text || "").trim().startsWith("{") || (text || "").trim().startsWith("[")) ? tryJson() : null;
    if (jsonFirst && looksLikeV8Instance(jsonFirst) && (kindHint === "composition" || !kindHint || ext === "json")) {
      const obj = jsonFirst;
      const patName = patient || obj.name && loc(obj.name) || name;
      const patientObj = obj.k === "patient" ? obj : { id: "up:" + rec.id, k: "patient", name: patName, uploaded: true, children: [obj] };
      patientObj.uploaded = true;
      if (patient) patientObj.name = patient;
      addOrMergePatient(patientObj);
      out.ok = true; out.kind = "composition"; out.message = T("loadedAs") + " " + (patientObj.name && loc(patientObj.name)); out.models.push(patientObj.id);
      return out;
    }
    const looksOptXml = (kindHint === "template" || /\.(opt|oet)$/i.test(name) || ((text || "").trim().startsWith("<") && /<(operational_template|template)\b/i.test(text) && !/<composition\b/i.test((text || "").slice(0, 2000))));
    if (looksOptXml && lib.parseTemplateInput) {
      const r = lib.parseTemplateInput(text);
      const opt = r.operationalTemplate || r.opt || r;
      if (opt && lib.buildWebTemplate) {
        const wt = lib.buildWebTemplate(opt, { languages: ["sv", "en"] });
        const tpl = attachWt(webTemplateToOurs(wt, rec.id), wt, rec);
        D.templates.push(tpl);
        out.ok = true; out.kind = "template"; out.message = T("loadedAs") + " " + loc(tpl.name); out.models.push(tpl.id);
        return out;
      }
    }
    if (looksOptXml && lib.parseOptXml && (text || "").trim().startsWith("<")) {
      const r = lib.parseOptXml(text);
      const opt = r.operationalTemplate || r.opt || r;
      if (opt && lib.buildWebTemplate) {
        const wt = lib.buildWebTemplate(opt, { languages: ["sv", "en"] });
        const tpl = attachWt(webTemplateToOurs(wt, rec.id), wt, rec);
        D.templates.push(tpl);
        out.ok = true; out.kind = "template"; out.message = T("loadedAs") + " " + loc(tpl.name); out.models.push(tpl.id);
        return out;
      }
    }
    if ((kindHint === "archetype" || ext === "adl" || ext === "adls") && lib.parseAdl) {
      const r = lib.parseAdl(text);
      const arch = archetypeToOurs(r, rec.id);
      D.archetypes.push(arch);
      out.ok = true; out.kind = "archetype"; out.message = T("loadedAs") + " " + loc(arch.label); out.models.push(arch.id);
      return out;
    }
    // FLAT JSON (needs a previously loaded web template; match by root key)
    if (jsonFirst && isFlatPayload(jsonFirst) && (kindHint === "composition" || !kindHint || ext === "json")) {
      if (!lib.deserializeFromFlatWithIssues && !lib.deserializeFromFlat) throw new Error("FLAT JSON needs ehrtslib deserializeFromFlat");
      let wt = null;
      if (rec.wtJson && lib.parseWebTemplate) {
        try { wt = lib.parseWebTemplate(rec.wtJson); } catch (e) { wt = null; }
      }
      if (!wt) wt = findWtForFlat(jsonFirst);
      if (!wt) throw new Error("FLAT JSON needs a loaded template (OPT / web template) first");
      rec.wtJson = rec.wtJson || JSON.stringify(wt);
      let comp = null, issues = [];
      if (lib.deserializeFromFlatWithIssues) {
        const r = lib.deserializeFromFlatWithIssues(jsonFirst, wt);
        comp = r.composition; issues = r.issues || [];
      } else {
        comp = lib.deserializeFromFlat(jsonFirst, wt);
      }
      if (!comp) throw new Error("FLAT deserialization returned no composition");
      const pat = addOrMergePatient(compositionToPatient(comp, patient || name, rec.id, wt, jsonFirst));
      out.ok = true; out.kind = "composition";
      out.message = T("loadedAs") + " " + loc(pat.name) + (issues.length ? " (" + issues.length + " " + T("flatIssues") + ")" : "");
      out.models.push(pat.id);
      out.issues = issues;
      const codes = collectTreeCodes(pat, []);
      await ensureCodes(codes);
      return out;
    }
    if (kindHint === "composition" || ext === "xml" || /COMPOSITION|composition/.test((text || "").slice(0, 800))) {
      if (ext === "xml" || (text || "").trim().startsWith("<")) {
        const comp = new lib.XmlDeserializer().deserialize(text);
        const pat = addOrMergePatient(compositionToPatient(comp, patient || name, rec.id));
        out.ok = true; out.kind = "composition"; out.message = T("loadedAs") + " " + loc(pat.name); out.models.push(pat.id);
        await ensureCodes(collectTreeCodes(pat, []));
        return out;
      }
      const json = jsonFirst || tryJson();
      if (json) {
        let comp;
        try { comp = new lib.JsonConfigurableDeserializer().deserialize(typeof json === "string" ? json : JSON.stringify(json)); }
        catch (e1) { try { comp = new lib.JsonCanonicalDeserializer().deserialize(typeof json === "string" ? json : JSON.stringify(json)); } catch (e2) { comp = null; } }
        if (comp) {
          const pat = addOrMergePatient(compositionToPatient(comp, patient || name, rec.id));
          out.ok = true; out.kind = "composition"; out.message = T("loadedAs") + " " + loc(pat.name); out.models.push(pat.id);
          await ensureCodes(collectTreeCodes(pat, []));
          return out;
        }
      }
    }
    if (ext === "json" || jsonFirst) {
      const json = jsonFirst || tryJson();
      if (json && (json.tree || json.templateId || json.webTemplate)) {
        const raw = json.webTemplate || json;
        const wt = lib.parseWebTemplate ? lib.parseWebTemplate(raw) : raw;
        const tpl = attachWt(webTemplateToOurs(wt, rec.id), wt, rec);
        D.templates.push(tpl);
        out.ok = true; out.kind = "template"; out.message = T("loadedAs") + " " + loc(tpl.name); out.models.push(tpl.id);
        return out;
      }
    }
    throw new Error("unrecognized format");
  } catch (e) {
    out.ok = false; out.message = (e && e.message) ? e.message : String(e);
    return out;
  }
}

async function reloadFromUploads() {
  D = structuredClone(V8SRC);
  const files = await idbAll();
  setUploadBusy(true, T("upBusyReload"));
  try {
    for (const f of files) {
      const r = await ingestText(f);
      f.result = r;
      const slim = { ...f };
      delete slim._wt;
      await idbPut(slim);
    }
  } finally { setUploadBusy(false); }
  rebuildIndexes();
  refreshPatientButtons();
  applyI18n();
  render();
  refreshFileList(files);
}

function refreshFileList(files) {
  const ul = document.getElementById("fileList");
  if (!ul) return;
  if (!files || !files.length) { ul.innerHTML = "<li class='muted'>" + T("noFiles") + "</li>"; return; }
  ul.innerHTML = files.map((f) => {
    const st = f.result ? (f.result.ok ? "ok" : "err") : "idle";
    const msg = f.result ? f.result.message : "";
    const pat = f.patient ? " [" + f.patient + "]" : "";
    return `<li data-fid="${f.id}" class="${st}"><code>${f.name}</code>${pat} — ${f.kindHint || ""} ${msg ? "· " + msg : ""} <button data-del="${f.id}" type="button">×</button></li>`;
  }).join("");
  ul.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => { await idbDel(b.dataset.del); await reloadFromUploads(); }));
}

async function storeFiles(fileList, kindHint, fromDirectory) {
  const arr = [...fileList];
  setUploadBusy(true, T("upBusy"));
  try {
    for (const file of arr) {
      const rel = file.webkitRelativePath || file.name;
      let patient = null;
      if (fromDirectory && file.webkitRelativePath) {
        const parts = file.webkitRelativePath.split("/");
        if (parts.length >= 3) patient = parts[1];
        else if (parts.length === 2) patient = parts[0];
        else patient = parts[0];
      }
      const text = await file.text();
      const rec = { id: kindHint + ":" + rel + ":" + file.size + ":" + file.lastModified, kindHint, name: file.name, path: rel, patient, type: file.type, text, added: Date.now(), result: null };
      const r = await ingestText(rec);
      rec.result = r;
      const slim = { ...rec };
      delete slim._wt;
      await idbPut(slim);
    }
  } catch (e) { console.warn("upload", e); }
  finally { setUploadBusy(false); }
  try { rebuildIndexes(); refreshPatientButtons(); render(); } catch (e) { console.warn("upload render", e); }
  refreshFileList(await idbAll());
}

function patientKey(p) {
  if (!p) return "";
  if (typeof p.name === "string") return p.name;
  return (p.name && (p.name.sv || p.name.en)) || p.id || "";
}
function patientShort(p) {
  const k = patientKey(p);
  if (k === "Eva Holmgren") return "Eva";
  if (k === "Lars Nyström" || k === "Lars Nystrom") return "Lars";
  return k;
}
function refreshPatientButtons() {
  const host = document.getElementById("patBtns");
  if (!host || typeof D === "undefined") return;
  const pats = (D.patients || []).filter((p) => !p.synthetic);
  const seen = new Set();
  const list = [];
  for (const p of pats) {
    const k = patientKey(p);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    list.push(p);
  }
  if (S.patient !== "both" && !seen.has(S.patient)) S.patient = "both";
  host.innerHTML = `<button type="button" data-p="both" data-i18n="both">${T("both")}</button>` +
    list.map((p) => {
      const k = patientKey(p);
      const on = S.patient === k ? ' class="on"' : "";
      const esc = String(k).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      return `<button type="button" data-p="${esc}"${on}>${patientShort(p).replace(/</g, "&lt;")}</button>`;
    }).join("");
  if (S.patient === "both") host.querySelector("[data-p='both']")?.classList.add("on");
  d3.selectAll("#patBtns [data-p]").on("click", function () {
    S.patient = this.dataset.p;
    d3.selectAll("#patBtns [data-p]").classed("on", false);
    d3.select(this).classed("on", true);
    render();
  });
}

function bindSettings() {
  const panel = document.getElementById("settings");
  const btn = document.getElementById("settingsBtn");
  btn.addEventListener("click", (ev) => { ev.stopPropagation(); const open = panel.hasAttribute("hidden") === false; if (open) panel.setAttribute("hidden", ""); else { panel.removeAttribute("hidden"); applyI18n(); updateTxStatus(); } });
  document.addEventListener("click", (ev) => { if (panel && !panel.contains(ev.target) && ev.target !== btn) panel.setAttribute("hidden", ""); });
  d3.selectAll("[data-lang]").on("click", function (ev) { ev.stopPropagation(); setLang(this.dataset.lang, true); });
  document.querySelectorAll("input[name=anim]").forEach((r) => {
    r.checked = r.value === S.anim;
    r.addEventListener("change", () => { if (r.checked) { S.anim = r.value; persistSettings(); render(); } });
  });
  const tx = document.getElementById("txUrl");
  tx.value = S.txUrl;
  tx.addEventListener("change", () => { S.txUrl = tx.value.trim() || DEFAULTS.txUrl; persistSettings(); txLastStatus = ""; updateTxStatus(); });
  document.getElementById("reset-lang").addEventListener("click", () => setLang(DEFAULTS.lang, true));
  document.getElementById("reset-anim").addEventListener("click", () => { S.anim = DEFAULTS.anim; persistSettings(); document.querySelectorAll("input[name=anim]").forEach((r) => { r.checked = r.value === S.anim; }); render(); });
  document.getElementById("reset-txUrl").addEventListener("click", () => { S.txUrl = DEFAULTS.txUrl; tx.value = S.txUrl; persistSettings(); txLastStatus = ""; updateTxStatus(); });
  document.getElementById("resetAll").addEventListener("click", async () => {
    if (!confirm(T("resetConfirm"))) return;
    await idbClear();
    S.lang = DEFAULTS.lang; S.anim = DEFAULTS.anim; S.txUrl = DEFAULTS.txUrl;
    persistSettings();
    tx.value = S.txUrl;
    document.querySelectorAll("input[name=anim]").forEach((r) => { r.checked = r.value === S.anim; });
    D = structuredClone(V8SRC);
    rebuildIndexes();
    refreshPatientButtons();
    applyI18n();
    render();
    refreshFileList([]);
  });
  document.getElementById("upArch").addEventListener("change", (ev) => storeFiles(ev.target.files, "archetype", false));
  document.getElementById("upTpl").addEventListener("change", (ev) => storeFiles(ev.target.files, "template", false));
  document.getElementById("upInst").addEventListener("change", (ev) => storeFiles(ev.target.files, "composition", true));
  if (window.matchMedia) window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => { applyI18n(); if (S.anim === "system") render(); });
}
