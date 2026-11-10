# International Patient Summary knowledge-graph example

Verified data for an interactive knowledge-graph demo of the official openEHR International Patient Summary (IPS) template, its archetypes, selected nodes, terminology concepts, and two fictitious composition instances.

The data format is generic (`template-kg-example/v1`) so further template examples can be added later, in the same spirit as TermViz loading models via `publicUrl()`.

This example is **Swedish-oriented**. Preferred code systems are those actually offered by the Nordic Ontoserver, with Swedish editions and names used where they resolve:

| Use | Preferred system | On the Ontoserver? | Used in the graph? |
| --- | --- | --- | --- |
| Clinical findings, procedures, substances, laterality | **SNOMED CT, Swedish edition** (`45991000052106 / 20251130`), `displayLanguage=sv` | Yes, `$lookup` works | Yes (preferred). International edition is also recorded (TermViz default, and the edition returned for expression `$lookup`). |
| Laboratory results | **NPU** (`http://npu-terminology.org`, INT 2026-10-30, 27 867 codes) | Yes, `$lookup` and ValueSet `$validate-code` work | Yes |
| Diagnoses (classification) | **ICD-10-SE** | **No** — not listed | No. Closest resolvable system is WHO ICD-10 (`http://hl7.org/fhir/sid/icd-10`, version `2019-covid-expanded`, resource name `ICD_10_EN`). |
| Medications | **ATC** (`http://www.whocc.no/atc`) | Listed, `content=not-present`; `$lookup` / implicit `$expand` fail | Yes, with Swedish names from [FASS Vård ATC-register](https://fass.se/health/atc/) retrieved 2026-11-10 (Europe/Stockholm). |
| Procedures (Swedish classification) | **KVÅ** (Klassifikation av vårdåtgärder) | A stub CodeSystem titled KVÅ at `http://piirainformatics.se/uri/` is listed (`status=draft`, `count=0`) | **Not used** (empty). Procedure instances are SNOMED-only. |
| Units | **UCUM** | Listed, `$lookup` does not resolve | Unit codes are still recorded as conventional UCUM strings (`listed-not-resolvable`). |
| Laboratory / observations (international) | LOINC | No `http://loinc.org` CodeSystem in the catalog (only pan-Canadian pCLOCD, `not-present`) | **Omitted** — LOINC is little used in Sweden. A few official archetype term bindings remain in the ADL; they are listed below and are not graph edges. |

No SNOMED↔ATC, SNOMED↔ICD-10 or SNOMED↔NPU ConceptMap was found on the server. Cross-ontology pairing is only at the **instance** layer (`coded_as` edges from the same entry to both codes), never as an asserted map.

---

## How to load the data

Schema: [`schema/template-kg-example.schema.json`](schema/template-kg-example.schema.json) (`schema` const = `template-kg-example/v1`).

1. Fetch [`examples/manifest.json`](examples/manifest.json).
2. For each entry, fetch `examples/<path>` (currently only [`examples/international-patient-summary/ips-kg-example.json`](examples/international-patient-summary/ips-kg-example.json)).
3. Draw a graph from `nodes[]` and `edges[]`, using `type` on both.

[`ips-kg-spec.json`](ips-kg-spec.json) is a copy of the same example file, kept at the originally requested path.

Regenerate after editing the tables in `sources/`:

```bash
python3 sources/kg_phase2.py
```

(`kg_phase2.py` imports `kg_build.py`, which imports `kg_helpers.py` and the JSON tables `sources/kg-static.json`, `kg-concepts.json`, `kg-instances.json` plus the ADL extract and FHIR lookup caches.)

### How TermViz loads data today (read remotely, default branch `master`)

TermViz does **not** yet load this JSON. Its current IPS path, from `src/ips-model.js` / `src/mapper.js` / `src/snomed.js` on https://github.com/erik-sundvalls-bots/TermViz (branch **`master`**, not `main`):

- `loadIpsModel()` fetches `publicUrl("models/International_Patient_Summary.opt")`, `public/models/ips-fileset/adl-manifest.json`, each ADL, and `maps/ips-snap2snomed-extended.csv`.
- `loadTemplateFromUrl` can also take an OPT, OET, web template, ADL, or a GitHub `*.t.json` closure.
- Terminology calls go to `ONTOSERVER = https://tx-nordics.fhir.org/fhir/r4` with `SNOMED_SYSTEM = http://snomed.info/sct`, no auth:
  - `GET CodeSystem/$lookup?system&code&property=parent&property=inactive&_format=json`
  - `Accept: application/fhir+json`
  - `ValueSet/$expand` with `url=http://snomed.info/sct?fhir_vs=ecl/<!{code}` or `ecl/{code}` plus `includeDesignations`
- CORS allows `https://erik-sundvalls-bots.github.io` with credentials.

This example is designed so a future loader could resolve `examples/manifest.json` the same way TermViz resolves `publicUrl("models/…")`.

---

## Official IPS template

| Field | Value | Verification |
| --- | --- | --- |
| Name | International Patient Summary | verified-by-connector |
| CKM CID | [1013.26.376](https://ckm.openehr.org/ckm/templates/1013.26.376) | verified-by-connector |
| UID | `937fca6c-ec24-4c0f-8986-623843b6ebca` | verified-by-connector |
| CKM status / OET lifecycle | DRAFT / unmanaged | verified-by-connector |
| CKM version | 1 | verified-by-connector |
| Root archetype | `openEHR-EHR-COMPOSITION.health_summary.v1` | verified-by-connector |
| Author | Heather Leslie, Atomica Informatics, 2020-08-17 | verified-by-connector |
| Purpose | Early draft of the FHIR IPS IG v1.0.0 (EN 17269 / ISO 27269) for unplanned cross-border care | verified-by-connector |
| Fetched via | MCP `user-openehr assistant` `ckm_template_get` | — |
| Local OET | `sources/oet/International_Patient_Summary.oet` | — |

Later incubator templates (IPS Problem List 1013.26.1363, IPS Allergies 1013.26.1365) exist but are not the complete official IPS. This example uses the 2020 draft.

The template has **14 sections** (Medication Summary, Allergies & Intolerances and Problem List are mandatory) and **40 unique archetypes** in the OET. `openEHR-EHR-CLUSTER.anatomical_location.v1` is added as an extra archetype because `problem_diagnosis` slots it as Structured body site (`at0039`) even though the 2020 OET does not fill the slot — it is needed for the Fig 5b laterality example.

Two archetypes could not be fetched from CKM (`imaging_exam_result.v0`, `limitation_of_treatment.v0`). Their ADLs were copied from the TermViz IPS fileset and marked `verified-by-fileset`. `imaging_exam_result` is now published as v1 (CID 1013.1.1494).

---

## Nordic Ontoserver catalog

Base: **https://tx-nordics.fhir.org/fhir/r4**

Software (CapabilityStatement / TerminologyCapabilities, retrieved 2026-11-10): Ontoserver **6.31.0**, HAPI FHIR **8.12.1**, FHIR R4 **4.0.1**, CSIRO. TerminologyCapabilities date: **2026-11-10T09:35:40+01:00** (Europe/Stockholm).

Enumerated with:

```
GET <base>/CodeSystem?_summary=true&_count=500
GET <base>/ValueSet?_summary=true&_count=500
GET <base>/metadata
GET <base>/metadata?mode=terminology
```

| Resource | Pages | Entries | Unique URLs | Files |
| --- | --- | --- | --- | --- |
| CodeSystem | 3 | 1253 | 1233 | [codesystems.tsv](sources/fhir/codesystems.tsv), [CODESYSTEMS.md](sources/fhir/CODESYSTEMS.md) (full url / name / title / version list), [codesystem-catalog.json](sources/fhir/codesystem-catalog.json) |
| ValueSet | 4 | 1860 | — | [valuesets.tsv](sources/fhir/valuesets.tsv), [VALUESETS.md](sources/fhir/VALUESETS.md), [valueset-catalog.json](sources/fhir/valueset-catalog.json) |
| TerminologyCapabilities | — | 1233 codeSystems | — | [tc-metadata_mode_terminology.json](sources/fhir/tc-metadata_mode_terminology.json) |

The complete url / name / version listings live in those catalog files (too long to inline here). IPS-relevant entries:

| url | name | version | title | content | Resolves for `$lookup`? |
| --- | --- | --- | --- | --- | --- |
| `http://snomed.info/sct` | SNOMED_CT | `http://snomed.info/sct/45991000052106/version/20251130` | SNOMED CT Sweden NRC maintained module | not-present (typical for Ontoserver editions) | **Yes** (preferred; `displayLanguage=sv`) |
| `http://snomed.info/sct` | SNOMED_CT | `http://snomed.info/sct/900000000000207008/version/20250801` | SNOMED CT core | not-present | **Yes** (TermViz default; also 20250201 and 20250701 are listed) |
| `http://snomed.info/sct` | SNOMED_CT | `…/51000202101/version/20251015` and `…/20251215` | Norwegian module | not-present | (listed, not used) |
| `http://snomed.info/sct` | SNOMED_CT | `…/11000229106/version/20251115` | Finnish module | not-present | (listed, not used) |
| `http://snomed.info/sct` | SNOMED_CT | `…/554471000005108/version/20250930` | Danish module | not-present | (listed, not used) |
| `http://npu-terminology.org` | NPUTerminology | INT 2026-10-30 | NPU Terminology Code System | complete, 27867 | **Yes** |
| `http://hl7.org/fhir/sid/icd-10` | ICD_10_EN | 2019-covid-expanded | ICD-10-EN | complete, 13831 | **Yes** (used; **not** ICD-10-SE) |
| `http://hl7.org/fhir/sid/icd-10` | Icd10 | 2.1.1 | ICD-10 | not-present | No (unversioned/generic listing) |
| `http://www.whocc.no/atc` | WC | 2.0.1 | WHO ATC | not-present | **No** |
| `http://unitsofmeasure.org` | UCUM | 3.0.1 | Unified Code for Units of Measure (UCUM) | not-present | **No** |
| `http://piirainformatics.se/uri/` | KVACodeSystem | (none) | KVÅ | complete, **0** | Stub only |
| `http://loinc.org` | — | — | — | **absent** | — |

Operations tested against this server:

- `CodeSystem/$lookup` — works for SNOMED (including post-coordinated expressions), NPU, and WHO ICD-10. ATC and UCUM fail.
- `ValueSet/$expand` — works for SNOMED ECL implicit valuesets.
- `CodeSystem/$validate-code` (GET and POST) — **broken**: HTTP 400 “A code/system pair must be provided.”
- `ValueSet/$validate-code` POST — works for NPUFull (`NPU02319`, `result=true`).

---

## Selected SNOMED, NPU, ICD-10 and ATC concepts

Swedish displays below come from `$lookup` with `displayLanguage=sv` on the Swedish edition, unless noted. All of these SNOMED and NPU / ICD-10 codes are `verified-by-FHIR`. ATC captions are `sourced-from-FASS`.

### Fig 5b and official vital-sign bindings

| Code | Swedish display | English / notes |
| --- | --- | --- |
| 72704001 | fraktur | Fig 5b fracture concept. Parents include 37782003 (skada). |
| 24028007 | höger | Official **value** binding on `CLUSTER.anatomical_location.v1` term `at0004` (“Right”), which is a value of Laterality (`at0002`, itself bound to attribute 272741003). |
| 62413002 | (Finding site) Bone structure of radius | Used in the post-coordinated expression. |
| 75367002 | blodtryck | SNOMED CT is-a parent of systolic/diastolic BP observables (verified-by-FHIR). **Not** the IPS `blood_pressure.v2` `at0000` binding — that is **364090009**. |
| 364090009 | systemiskt artärtryck | Official BP `at0000` binding. |
| 271649006 / 271650006 | systoliskt / diastoliskt blodtryck | Official bindings on `at0004` / `at0005`. Both is-a 75367002. |
| 431314004 | perifer syremättnad | Official SpO2 `at0006` binding. This is “Peripheral oxygen saturation”, **not** the older “Peripheral pulse oximetry” label. is-a 103228002. |
| 103228002 | hemoglobinets syremättnad | Fig 5b parent concept. |

Post-coordinated expression (Fig 5b finding site + laterality), `$lookup` **verified-by-FHIR** (International edition):

```
72704001:363698007=62413002,272741003=24028007
```

Display: `Fracture:Laterality=Right,Finding site=Bone structure of radius`. Parent: 72704001.

### Shared vs patient-specific clinical concepts

| Code | Swedish display | Used by |
| --- | --- | --- |
| 59621000 | essentiell hypertoni | Both (plus ICD-10 I10) |
| 387506000 | atenolol | Both (plus ATC C07AB03) |
| 46233009 | vaccin mot influensavirus | Both (plus ATC J07BB) |
| 72704001 + expression + S52.5 | fraktur of lower end of right radius | Eva only |
| 91936005 | penicillinallergi | Eva only |
| 239279000 | fixering av fraktur | Eva only (no KVÅ) |
| NPU02319 | B—Haemoglobin(Fe); subst.c. = ? mmol/L | Eva only — use **mmol/L**, not g/L. Designations en-GB only. |
| 44054006 | diabetes mellitus typ 2 | Lars only (plus ICD-10 E11.9) |
| 91935009 | jordnötsallergi | Lars only |
| 109081006 | läkemedel som innehåller metformin | Lars only (plus ATC A10BA02). Not 387517004 (acetaminophen). |
| 80146002 | appendektomi | Lars only (no KVÅ) |
| NPU27300 | Haemoglobin beta chain(B)—N-(1-deoxyfructos-1-yl)haemoglobin beta chain; subst.fr. = ? mmol/mol | Lars only (HbA1c IFCC), unit mmol/mol. Official Ontoserver display is this long chemical name. Designations en-GB only. |

ICD-10 (WHO, English, 2019-covid-expanded) — **not** ICD-10-SE:

| Code | Display | Parent |
| --- | --- | --- |
| I10 | Essential (primary) hypertension | I10-I15 Hypertensive diseases |
| E11.9 | Type 2 diabetes mellitus : Without complications | E11 → E10-E14 |
| S52.5 | Fracture of lower end of radius | S52 → S50-S59 |

ATC hierarchy with Swedish FASS names (2026-11-10), `is_a` edges follow the WHO/FASS tree:

- C → C07 → C07A → C07AB → **C07AB03 Atenolol** ([FASS](https://fass.se/health/atc/c07ab03))
- A → A10 → A10B → A10BA → **A10BA02 Metformin** ([FASS](https://fass.se/health/atc/a10ba02))
- J → J07 → **J07BB Vaccin mot influensa** ([FASS](https://fass.se/health/atc/j07bb))

---

## Two fictitious IPS instances

Clearly synthetic IDs — **not** Swedish personnummer. Both compositions instantiate the same template / archetype / concept layer. Shared concepts: essential hypertension, atenolol, influenza vaccine, and the BP / SpO2 observables. Times are Europe/Stockholm.

**Eva Holmgren** (`ehr-demo-ips-001`), composition `demo-composition-eva-holmgren-ips-20260315`, 2026-03-15T10:30:00+01:00

- Fracture of the lower end of the right radius (SNOMED expression + 72704001 + ICD-10 **S52.5**; laterality 24028007, site 62413002)
- Penicillin allergy: SNOMED **91936005** (penicillinallergi) only — no ICD-10 on allergies
- Essential hypertension (59621000 / I10)
- Penicillin allergy (91936005)
- Atenolol 50 mg (387506000 / C07AB03)
- Influenza vaccine (46233009 / J07BB)
- Fixation of fracture (239279000)
- Haemoglobin NPU02319 = **8.2 mmol/L**
- Blood pressure 128/82 mm[Hg]
- SpO2 97 %

**Lars Nyström** (`ehr-demo-ips-002`), composition `demo-composition-lars-nystrom-ips-20260402`, 2026-04-02T14:15:00+02:00 (CEST)

- Type 2 diabetes mellitus without complications (44054006 / E11.9)
- Essential hypertension (shared)
- Peanut allergy (91935009)
- Atenolol 50 mg (shared) and Metformin 1000 mg (109081006 / A10BA02)
- Influenza vaccine (shared)
- Appendectomy (80146002)
- HbA1c NPU27300 = **58 mmol/mol**
- Blood pressure 148/94 mm[Hg]
- SpO2 94 %

Instance nodes use `instance_of` (composition → template, entry → archetype, element → archetype node), `contains`, `coded_as` and `unit`. Instance structure itself is `proposed/unverified` (synthetic data); every SNOMED / NPU / ICD-10 code on those instances was still `$lookup`-validated.

---

## Counts (generated 2026-11-10T17:40:00+01:00, Europe/Stockholm)

| | |
| --- | ---: |
| Nodes | 254 |
| Edges | 423 |
| Template archetypes (in the OET) | 40 |
| Extra archetypes | 1 (`CLUSTER.anatomical_location.v1`) |
| Sections | 14 |
| Composition instances | 2 |
| Patients | 2 |

By node type: template 1, section 14, archetype 41, archetype_node 76, concept 87, expression 1, patient 2, composition_instance 2, entry_instance 19, element_instance 11.

By edge type: contains 103, has_node 121, binding 63, instance_of 32, coded_as 47, is_a 28, slot 13, unit 11, refinement 5.

By verification (nodes): verified-by-connector 128, verified-by-FHIR 70, proposed/unverified 34, sourced-from-FASS 13, listed-not-resolvable 5, verified-by-fileset 4.

---

## Verification labels

| Label | Meaning |
| --- | --- |
| `verified-by-connector` | Template, archetype id/uid/at-code/path/RM type or official term binding taken from CKM via the openEHR assistant MCP (or the cleaned local ADL). |
| `verified-by-fileset` | ADL taken from the TermViz IPS fileset because CKM did not resolve that v0 id. |
| `verified-by-FHIR` | Display, activity and parents confirmed with `CodeSystem/$lookup` (or ValueSet `$validate-code` / `$expand`) on the Nordic Ontoserver. |
| `sourced-from-FASS` | Swedish ATC caption and hierarchy from fass.se, retrieved 2026-11-10. |
| `listed-not-resolvable` | Present in the Ontoserver CodeSystem catalog but `$lookup` / `$expand` fail (ATC, UCUM) or the resource is an empty stub used only as a catalog fact (KVÅ is listed this way in `ontologies[]`, and is not instantiated). |
| `absent-from-server` | Reserved; ICD-10-SE and LOINC are discussed in this README but are not graph nodes. |
| `proposed/unverified` | Proposed node/value binding, or synthetic instance structure. Codes hanging off these nodes are still FHIR-validated when they are SNOMED / NPU / ICD-10. |

Ids are never invented: archetype uids, at-codes, official bindings and terminology codes are taken from the OET/ADL or from `$lookup`. Missing items are labelled, not fabricated.

---

## Problems and gaps

- The official complete IPS template (CKM 1013.26.376, 2020 DRAFT) is an early unmanaged draft of FHIR IPS IG v1.0.0.
- `imaging_exam_result.v0` and `limitation_of_treatment.v0` were not in CKM; fileset fallback. Imaging is now published as v1.
- ICD-10-SE is not on the Nordic Ontoserver; WHO ICD-10 is used instead.
- KVÅ is only an empty stub (`count=0`) and was not used.
- ATC and UCUM are listed but not resolvable. ATC names come from FASS.
- `CodeSystem/$validate-code` is broken on this server.
- No ConceptMap between SNOMED and ATC / ICD-10 / NPU on the server.
- `CLUSTER.anatomical_location.v1` is slotted but not filled in the 2020 OET.
- Official BP `at0000` binding is **364090009** (from ADL term_bindings / CKM IPS). Fig 5b **75367002** is not bound on the archetype; it remains only as an is-a parent of 271649006/271650006. 431314004 is “perifer syremättnad”, not “Peripheral pulse oximetry”.
- LOINC is omitted from the graph. Leftover official LOINC term bindings still present in the IPS ADLs (not emitted as edges):
  - `body_mass_index.v2` `at0004` `[LOINC::39156-5]`
  - `body_weight.v2` `at0004` `[LOINC::29463-7]`
  - `height.v2` `at0004` `[LOINC::8302-2]`
  - `pulse_oximetry.v1` `at0006` `[LOINC::59408-5]`, `at0009` `[LOINC::20081-6]`, `at0044` `[LOINC::57800-5]`, `at0045` `[LOINC::86904-0]`, `at0046` `[LOINC::2614-6]`
- TermViz does not yet load this JSON (it loads OPT + ADL fileset + Snap2SNOMED CSV).
- The two patients are fictitious demo data.

---

## File paths

| Path | What |
| --- | --- |
| `schema/template-kg-example.schema.json` | Schema (`template-kg-example/v1`) |
| `examples/manifest.json` | Example catalog for a loader |
| `examples/international-patient-summary/ips-kg-example.json` | This example |
| `ips-kg-spec.json` | Copy of the example (original requested path) |
| `sources/oet/International_Patient_Summary.oet` | Official OET |
| `sources/adl/` | Cleaned ADLs (41 files) |
| `sources/adl-termviz-fileset/` | Fileset fallback ADLs |
| `sources/adl-extract.json` | Parsed uids, term bindings, ELEMENT paths, RM types |
| `sources/snomed-fhir-validation.json` | International-edition `$lookup` cache (incl. expressions) |
| `sources/fhir/lookups-se-npu-validate.json` | Swedish-edition `$lookup` + NPU designations + NPU `$validate-code` |
| `sources/fhir/extra-fhir.json` | ATC/UCUM/KVÅ/ICD-10 extra probes |
| `sources/fhir/codesystems.tsv`, `CODESYSTEMS.md` | Full CodeSystem catalog |
| `sources/fhir/valuesets.tsv`, `VALUESETS.md` | Full ValueSet catalog |
| `sources/kg_phase2.py` | Generator entry point |

This work does not merge any branch, post on Discourse, or edit the project Google Doc.
