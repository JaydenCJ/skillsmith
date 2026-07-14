/**
 * skillsmith — scaffold and validate agent skills.
 *
 * Everything the CLI does is available as a typed API: parse front-matter,
 * validate the schema, analyze argument placeholders, check structure and
 * test stubs, scaffold new skills, and discover skills in a tree.
 */

export { analyzeArguments, checkArguments, hintArity } from "./args.js";
export type { ArgUsage } from "./args.js";
export {
  editDistance,
  err,
  errorCount,
  renderDiagnostic,
  sortDiagnostics,
  suggestKey,
  warn,
  warningCount,
} from "./diagnostics.js";
export type { Diagnostic, Severity } from "./diagnostics.js";
export { discoverSkills } from "./discover.js";
export { parseFrontmatter } from "./frontmatter.js";
export type { FrontmatterResult } from "./frontmatter.js";
export {
  DESCRIPTION_MAX_LENGTH,
  DESCRIPTION_MIN_LENGTH,
  KNOWN_KEYS,
  NAME_MAX_LENGTH,
  NAME_PATTERN,
  validateFrontmatter,
} from "./schema.js";
export type { SchemaResult, SkillMeta } from "./schema.js";
export { renderSkillMd, renderTestStub, ScaffoldError, scaffoldSkill } from "./scaffold.js";
export type { ScaffoldOptions, ScaffoldResult } from "./scaffold.js";
export { checkStructure, extractReferences } from "./structure.js";
export type { BodyReference, StructureOptions } from "./structure.js";
export { checkTestSpec, parseTestSpec, TESTSPEC_FILE, TESTSPEC_VERSION } from "./testspec.js";
export type { TestCase, TestExpectation, TestSpec, TestSpecResult } from "./testspec.js";
export { BODY_MAX_LINES, runSkillTests, validateSkill, validateSkillSource } from "./validate.js";
export type { SkillReport, TestRunSummary } from "./validate.js";
export { parseYaml } from "./yaml.js";
export type { YamlDoc, YamlError } from "./yaml.js";
export { VERSION } from "./version.js";
