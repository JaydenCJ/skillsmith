/**
 * The `tests/cases.yaml` stub format (`skillsmith-tests: 1`) and its
 * checks. A case names a realistic prompt that should trigger the skill,
 * the arguments it is invoked with, and what a good result must contain.
 * skillsmith cannot run your model — but it CAN verify, offline and
 * deterministically, that every case is well-formed, unique, consistent
 * with the skill's declared arguments, and that every expected file
 * actually ships with the skill. That is the class of test-stub rot that
 * otherwise goes unnoticed until an eval run burns tokens on it.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { Diagnostic, err, warn } from "./diagnostics.js";
import { ArgUsage } from "./args.js";
import { SkillMeta } from "./schema.js";
import { parseYaml } from "./yaml.js";

export const TESTSPEC_VERSION = 1;
export const TESTSPEC_FILE = "tests/cases.yaml";

export interface TestExpectation {
  /** Files (relative to the skill dir) the case relies on. */
  files?: string[];
  /** Substrings a good output must contain. */
  outputContains?: string[];
}

export interface TestCase {
  name: string;
  prompt: string;
  args?: string;
  expect?: TestExpectation;
}

export interface TestSpec {
  version: number;
  cases: TestCase[];
}

export interface TestSpecResult {
  spec: TestSpec | null;
  diagnostics: Diagnostic[];
}

const CASE_NAME = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const PLACEHOLDER = /\b(?:TODO|FIXME|TBD)\b/;

function at(line: number | undefined): { file: string; line?: number } {
  return line === undefined ? { file: TESTSPEC_FILE } : { file: TESTSPEC_FILE, line };
}

/** Parse and structurally validate a cases.yaml source string. */
export function parseTestSpec(source: string): TestSpecResult {
  const diags: Diagnostic[] = [];
  const doc = parseYaml(source);
  for (const e of doc.errors) diags.push(err("E_TESTSPEC", e.message, at(e.line)));
  const root = doc.value;
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    diags.push(err("E_TESTSPEC", "cases.yaml must be a mapping with `skillsmith-tests` and `cases`", at(1)));
    return { spec: null, diagnostics: diags };
  }
  const map = root as Record<string, unknown>;
  const version = map["skillsmith-tests"];
  if (version !== TESTSPEC_VERSION) {
    diags.push(
      err(
        "E_TESTSPEC_VERSION",
        version === undefined
          ? "missing `skillsmith-tests: 1` version marker"
          : `unsupported test-spec version ${JSON.stringify(version)} (this skillsmith understands 1)`,
        at(doc.keyLines["skillsmith-tests"]),
      ),
    );
    return { spec: null, diagnostics: diags };
  }
  const rawCases = map["cases"];
  if (!Array.isArray(rawCases) || rawCases.length === 0) {
    diags.push(err("E_TESTSPEC", "`cases` must be a non-empty list", at(doc.keyLines["cases"])));
    return { spec: null, diagnostics: diags };
  }

  const cases: TestCase[] = [];
  const names = new Set<string>();
  for (let i = 0; i < rawCases.length; i++) {
    const raw = rawCases[i];
    const lineFor = (field: string): number | undefined => doc.keyLines[`cases[${i}].${field}`];
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      diags.push(err("E_CASE_TYPE", `cases[${i}] must be a mapping`, at(doc.keyLines["cases"])));
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const name = entry["name"];
    const prompt = entry["prompt"];
    let ok = true;
    if (typeof name !== "string" || name === "") {
      diags.push(err("E_CASE_FIELD", `cases[${i}] is missing a non-empty \`name\``, at(lineFor("name"))));
      ok = false;
    } else {
      if (!CASE_NAME.test(name)) {
        diags.push(err("E_CASE_FIELD", `case name "${name}" must be a lowercase slug`, at(lineFor("name"))));
        ok = false;
      }
      if (names.has(name)) {
        diags.push(err("E_DUPLICATE_CASE", `case name "${name}" is used more than once`, at(lineFor("name"))));
        ok = false;
      }
      names.add(name);
    }
    if (typeof prompt !== "string" || prompt.trim() === "") {
      diags.push(err("E_CASE_FIELD", `cases[${i}] is missing a non-empty \`prompt\``, at(lineFor("prompt") ?? lineFor("name"))));
      ok = false;
    } else if (PLACEHOLDER.test(prompt)) {
      diags.push(warn("W_CASE_TODO", `case "${String(name)}" still has a placeholder prompt`, at(lineFor("prompt"))));
    }
    const args = entry["args"];
    if (args !== undefined && typeof args !== "string" && typeof args !== "number") {
      diags.push(err("E_CASE_TYPE", `cases[${i}].args must be a string`, at(lineFor("args"))));
      ok = false;
    }
    let expect: TestExpectation | undefined;
    if (entry["expect"] !== undefined) {
      expect = parseExpect(entry["expect"], i, lineFor, diags) ?? undefined;
      if (expect === undefined) ok = false;
    }
    for (const key of Object.keys(entry)) {
      if (!["name", "prompt", "args", "expect"].includes(key)) {
        diags.push(warn("W_CASE_UNKNOWN_KEY", `cases[${i}] has unknown key \`${key}\``, at(lineFor(key))));
      }
    }
    if (!ok || typeof name !== "string" || typeof prompt !== "string") continue;
    const testCase: TestCase = { name, prompt };
    if (args !== undefined) testCase.args = String(args);
    if (expect !== undefined) testCase.expect = expect;
    cases.push(testCase);
  }

  return { spec: { version: TESTSPEC_VERSION, cases }, diagnostics: diags };
}

function parseExpect(
  raw: unknown,
  index: number,
  lineFor: (field: string) => number | undefined,
  diags: Diagnostic[],
): TestExpectation | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    diags.push(err("E_CASE_TYPE", `cases[${index}].expect must be a mapping`, at(lineFor("expect"))));
    return null;
  }
  const map = raw as Record<string, unknown>;
  const expect: TestExpectation = {};
  for (const [key, listKey] of [
    ["files", "files"],
    ["output-contains", "outputContains"],
  ] as const) {
    const value = map[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || v === "")) {
      diags.push(err("E_CASE_TYPE", `cases[${index}].expect.${key} must be a list of non-empty strings`, at(lineFor(`expect.${key}`))));
      return null;
    }
    expect[listKey] = value as string[];
  }
  for (const key of Object.keys(map)) {
    if (key !== "files" && key !== "output-contains") {
      diags.push(warn("W_CASE_UNKNOWN_KEY", `cases[${index}].expect has unknown key \`${key}\``, at(lineFor(`expect.${key}`))));
    }
  }
  return expect;
}

/**
 * Cross-check a parsed spec against the skill it tests: expected files must
 * ship, argument arity must satisfy the body's positional placeholders, and
 * skills that take arguments should be exercised with some.
 */
export function checkTestSpec(
  spec: TestSpec,
  skill: { dir: string; meta: Pick<SkillMeta, "argumentHint"> | null; usage: ArgUsage },
): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const testCase of spec.cases) {
    for (const file of testCase.expect?.files ?? []) {
      if (file.split("/").includes("..") || file.startsWith("/")) {
        diags.push(err("E_CASE_FILE", `case "${testCase.name}" expects "${file}", which escapes the skill directory`, at(undefined)));
        continue;
      }
      if (!existsSync(join(skill.dir, ...file.split("/")))) {
        diags.push(err("E_CASE_FILE", `case "${testCase.name}" expects "${file}" but the skill does not ship it`, at(undefined)));
      }
    }
    // An explicitly empty `args: ""` documents the no-argument invocation
    // path and is never an arity problem.
    const words = (testCase.args ?? "").trim() === "" ? 0 : (testCase.args as string).trim().split(/\s+/).length;
    if (skill.usage.maxPosition > 0 && words > 0 && words < skill.usage.maxPosition) {
      diags.push(
        warn(
          "W_CASE_ARITY",
          `case "${testCase.name}" passes ${words} argument word(s) but the body reads up to $${skill.usage.maxPosition}`,
          at(undefined),
        ),
      );
    }
    const takesArgs = skill.usage.usesArguments || skill.usage.maxPosition > 0;
    if (takesArgs && testCase.args === undefined) {
      diags.push(warn("W_CASE_NO_ARGS", `case "${testCase.name}" has no \`args\` but the skill consumes arguments`, at(undefined)));
    }
  }
  return diags;
}
