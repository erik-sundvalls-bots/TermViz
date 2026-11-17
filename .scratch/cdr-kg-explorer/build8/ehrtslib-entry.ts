/** Browser entry for the V8 demo. Imports parse/serialize APIs from local ehrtslib v0.12. Does not modify the ehrtslib repo. */
export { parseAdl } from "../../../ehrtslib-rel/parser/parse_adl.ts";
export { parseTemplateInput } from "../../../ehrtslib-rel/parser/legacy/parse_template_input.ts";
export { parseOptXml } from "../../../ehrtslib-rel/parser/legacy/opt_xml_parser.ts";
export { JsonConfigurableDeserializer } from "../../../ehrtslib-rel/serialization/json/json_configurable_deserializer.ts";
export { JsonCanonicalDeserializer } from "../../../ehrtslib-rel/serialization/json/json_canonical_deserializer.ts";
export { XmlDeserializer } from "../../../ehrtslib-rel/serialization/xml/xml_deserializer.ts";
export { buildWebTemplate } from "../../../ehrtslib-rel/serialization/simplified/web_template_builder.ts";
export { parseWebTemplate } from "../../../ehrtslib-rel/serialization/simplified/web_template_parser.ts";
export {
  deserializeFromFlat,
  deserializeFromFlatJson,
  deserializeFromFlatWithIssues,
} from "../../../ehrtslib-rel/serialization/simplified/flat_deserializer.ts";
export { serializeToFlat, serializeToFlatJson } from "../../../ehrtslib-rel/serialization/simplified/flat_serializer.ts";
export { toTypedRm } from "../../../ehrtslib-rel/serialization/simplified/typed_rm.ts";
export { registerOpenEhrModelTypes } from "../../../ehrtslib-rel/serialization/common/openehr_model_registry.ts";
import { registerOpenEhrModelTypes as _registerOpenEhrModelTypes } from "../../../ehrtslib-rel/serialization/common/openehr_model_registry.ts";
_registerOpenEhrModelTypes();
export { collectRmPropertyNames, walkRmTreeToPlain, resolveRmTypeName } from "../../../ehrtslib-rel/serialization/common/rm_tree_walker.ts";
export { normalizeWebTemplateId, templateRootId } from "../../../ehrtslib-rel/serialization/simplified/normalize.ts";
export const EHRTSlibVersion = "0.12.0";
