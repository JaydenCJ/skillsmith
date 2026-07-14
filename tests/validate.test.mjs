// The orchestrating pipeline: how the layers compose into one report,
// body hygiene rules, and the on-disk entry points (directory, SKILL.md
// path, bare .md file). The bundled examples are pinned here too, so the
// README's advertised output can never silently drift.
import { strict as assert } from "node:assert";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runSkillTests, validateSkill, validateSkillSource } from "../dist/validate.js";
import { EXAMPLES, skillSource, tempDir, writeSkill, CASES_YAML } from "./helpers.mjs";

test("a healthy source reports ok with zero diagnostics (pure path)", () => {
  const report = validateSkillSource(skillSource());
  assert.equal(report.ok, true);
  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.name, "demo-skill");
});

test("E_EMPTY_BODY when nothing follows the front-matter", () => {
  const report = validateSkillSource("---\nname: demo\ndescription: Use when testing empty bodies.\n---\n   \n");
  assert.deepEqual(report.diagnostics.map((d) => d.code), ["E_EMPTY_BODY"]);
  assert.equal(report.ok, false);
});

test("W_BODY_LONG past 500 lines, anchored at the body start", () => {
  const body = "\n# head\n" + "instruction line\n".repeat(510);
  const report = validateSkillSource(skillSource({ body }));
  const long = report.diagnostics.find((d) => d.code === "W_BODY_LONG");
  assert.ok(long);
  assert.match(long.message, /references\//);
});

test("W_PLACEHOLDER carries the exact file line of each TODO", () => {
  const body = "\nline a\nTODO: fix\nline c\nFIXME later\n";
  const report = validateSkillSource(skillSource({ body }));
  const placeholders = report.diagnostics.filter((d) => d.code === "W_PLACEHOLDER");
  assert.deepEqual(placeholders.map((d) => d.line), [7, 9], "body starts at file line 5");
});

test("fence failure short-circuits schema noise: only the fence error appears", () => {
  const report = validateSkillSource("# no front-matter at all\nbody");
  assert.deepEqual(report.diagnostics.map((d) => d.code), ["E_NO_FRONTMATTER"]);
});

test("diagnostics come out sorted: errors first, then by file and line", () => {
  const source = [
    "---",
    "name: Bad_Name",
    "description: too short",
    "---",
    "",
    "TODO: body",
    "[gone](references/gone.md)",
  ].join("\n");
  const dir = writeSkill(tempDir(), "elsewhere", { source });
  const report = validateSkill(dir);
  const severities = report.diagnostics.map((d) => d.severity);
  const firstWarning = severities.indexOf("warning");
  assert.ok(!severities.slice(firstWarning).includes("error"), "no error after the first warning");
  const errorLines = report.diagnostics.filter((d) => d.severity === "error" && d.line !== undefined).map((d) => d.line);
  assert.deepEqual(errorLines, [...errorLines].sort((a, b) => a - b));
});

test("validateSkill accepts a directory, its SKILL.md, or a bare .md file", () => {
  const dir = writeSkill(tempDir(), "demo-skill", { files: { "tests/cases.yaml": CASES_YAML } });
  const viaDir = validateSkill(dir);
  const viaFile = validateSkill(join(dir, "SKILL.md"));
  assert.equal(viaDir.name, "demo-skill");
  assert.equal(viaFile.name, "demo-skill");
  assert.equal(viaDir.errors, viaFile.errors);
  // Missing targets throw; the CLI maps this to exit 2.
  assert.throws(() => validateSkill(join(tempDir(), "nope")), /no such file or directory/);
  assert.throws(() => validateSkill(tempDir()), /no SKILL\.md/);
});

test("a bare .md file skips the directory-name check; SKILL.md paths keep it", () => {
  const parent = tempDir();
  const dir = writeSkill(parent, "scratch", { source: skillSource({ name: "demo-skill" }) });
  const renamed = join(dir, "SKILL.md");
  const asSkillMd = validateSkill(renamed);
  assert.ok(asSkillMd.diagnostics.some((d) => d.code === "E_NAME_MISMATCH"), "SKILL.md path keeps the check");
  copyFileSync(renamed, join(dir, "draft.md"));
  const asDraft = validateSkill(join(dir, "draft.md"));
  assert.ok(!asDraft.diagnostics.some((d) => d.code === "E_NAME_MISMATCH"), "bare file skips it");
});

test("the bundled changelog-draft example is spotless", () => {
  const report = validateSkill(join(EXAMPLES, "changelog-draft"));
  assert.equal(report.errors, 0, JSON.stringify(report.diagnostics));
  assert.equal(report.warnings, 0, JSON.stringify(report.diagnostics));
  assert.equal(report.testSpec.cases.length, 2);
});

test("the bundled needs-work example carries exactly the advertised findings", () => {
  const report = validateSkill(join(EXAMPLES, "needs-work"));
  assert.deepEqual(report.diagnostics.map((d) => d.code).sort(), [
    "E_BROKEN_REF",
    "E_NAME_MISMATCH",
    "E_NAME_PATTERN",
    "W_DESC_NO_TRIGGER",
    "W_DESC_SHORT",
    "W_NO_HINT",
    "W_NO_TESTS",
    "W_PLACEHOLDER",
    "W_UNKNOWN_KEY",
  ]);
});

test("runSkillTests: passes on the healthy example, fails without a stub", () => {
  const healthy = runSkillTests(join(EXAMPLES, "changelog-draft"));
  assert.equal(healthy.cases, 2);
  assert.deepEqual(healthy.failures, []);
  const bare = writeSkill(tempDir(), "demo-skill");
  const missing = runSkillTests(bare);
  assert.equal(missing.cases, 0);
  assert.equal(missing.failures[0].code, "E_NO_TESTS");
});

test("runSkillTests: a stub expecting an unshipped file is a failure", () => {
  const dir = writeSkill(tempDir(), "demo-skill", {
    files: {
      "tests/cases.yaml": `skillsmith-tests: 1
cases:
  - name: wants-file
    prompt: p
    args: "x"
    expect:
      files: [references/gone.md]
`,
    },
  });
  const summary = runSkillTests(dir);
  assert.ok(summary.failures.some((d) => d.code === "E_CASE_FILE"));
});
