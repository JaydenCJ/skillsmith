// The scaffolder's contract: whatever `skillsmith new` writes must
// validate with zero errors immediately, carry its TODO markers so
// --strict refuses to ship it, and refuse to clobber existing work.
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { renderSkillMd, renderTestStub, scaffoldSkill, ScaffoldError } from "../dist/scaffold.js";
import { validateSkill, validateSkillSource } from "../dist/validate.js";
import { parseTestSpec } from "../dist/testspec.js";
import { tempDir } from "./helpers.mjs";

test("a default scaffold validates on disk with zero errors", () => {
  const result = scaffoldSkill({ name: "fresh-skill", dir: tempDir() });
  assert.deepEqual(result.files, ["SKILL.md", "references/README.md", "tests/cases.yaml"]);
  const report = validateSkill(result.dir);
  assert.equal(report.errors, 0, JSON.stringify(report.diagnostics));
  assert.equal(report.name, "fresh-skill");
  assert.ok(report.warnings > 0, "TODO markers must keep --strict honest");
  assert.ok(report.diagnostics.every((d) => ["W_PLACEHOLDER", "W_CASE_TODO"].includes(d.code)));
});

test("hint and tools flow into front-matter and the body wires $ARGUMENTS", () => {
  const source = renderSkillMd({ name: "with-args", hint: "[range]", tools: ["Bash(git log:*)", "Read"], model: "fast-1", license: "MIT" });
  const report = validateSkillSource(source);
  assert.equal(report.meta.argumentHint, "[range]");
  assert.deepEqual(report.meta.allowedTools, ["Bash(git log:*)", "Read"]);
  assert.equal(report.meta.model, "fast-1");
  assert.equal(report.meta.license, "MIT");
  assert.ok(report.usage.usesArguments, "body must consume the advertised arguments");
});

test("without a hint the body does not fake argument usage", () => {
  const report = validateSkillSource(renderSkillMd({ name: "no-args" }));
  assert.equal(report.usage.usesArguments, false);
  assert.ok(!report.diagnostics.some((d) => d.code === "W_HINT_UNUSED" || d.code === "W_NO_HINT"));
});

test("a custom description is used verbatim and wrapped for the fence", () => {
  const desc =
    "Summarizes long incident threads. Use when the user pastes an incident channel export. " +
    "Also covers escalation recaps, follow-up action items, and stakeholder-ready status one-liners.";
  const source = renderSkillMd({ name: "wrapped", description: desc });
  const report = validateSkillSource(source);
  assert.equal(report.meta.description, desc, "folded block scalar must round-trip the description");
  assert.ok(source.split("\n").every((l) => l.length <= 80), "front-matter lines stay reasonably short");
});

test("the generated test stub parses as a version-1 spec", () => {
  const stub = renderTestStub({ name: "any", hint: "[file]" });
  const parsed = parseTestSpec(stub);
  assert.notEqual(parsed.spec, null);
  assert.equal(parsed.spec.cases.length, 1);
  assert.equal(parsed.spec.cases[0].name, "happy-path");
  assert.ok(parsed.spec.cases[0].args !== undefined, "hinted skills get an args line");
});

test("--no-tests skips the stub; validate then warns W_NO_TESTS", () => {
  const result = scaffoldSkill({ name: "bare-skill", dir: tempDir(), noTests: true });
  assert.ok(!existsSync(join(result.dir, "tests")));
  const report = validateSkill(result.dir);
  assert.ok(report.diagnostics.some((d) => d.code === "W_NO_TESTS"));
});

test("invalid names are rejected with E_BAD_NAME before anything is written", () => {
  const parent = tempDir();
  for (const bad of ["UPPER", "has space", "-lead", "a".repeat(65)]) {
    assert.throws(
      () => scaffoldSkill({ name: bad, dir: parent }),
      (e) => e instanceof ScaffoldError && e.code === "E_BAD_NAME",
    );
  }
  assert.ok(!existsSync(join(parent, "UPPER")));
});

test("refuses a non-empty existing directory unless --force", () => {
  const parent = tempDir();
  const first = scaffoldSkill({ name: "twice", dir: parent });
  writeFileSync(join(first.dir, "SKILL.md"), "user edits\n");
  assert.throws(
    () => scaffoldSkill({ name: "twice", dir: parent }),
    (e) => e instanceof ScaffoldError && e.code === "E_EXISTS",
  );
  assert.equal(readFileSync(join(first.dir, "SKILL.md"), "utf8"), "user edits\n", "refusal must not touch files");
  scaffoldSkill({ name: "twice", dir: parent, force: true });
  assert.match(readFileSync(join(first.dir, "SKILL.md"), "utf8"), /^---/, "--force rewrites");
});
