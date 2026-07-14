// End-to-end tests against the compiled CLI in a child process: exit
// codes, output shapes, JSON mode, and the full author flow (new →
// validate → --strict → test) in a temp workspace.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CLI, EXAMPLES, PKG, runCli, tempDir } from "./helpers.mjs";

test("--version prints exactly the package.json version", () => {
  const pkg = JSON.parse(readFileSync(PKG, "utf8"));
  const r = runCli(["--version"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), pkg.version);
});

test("the CLI runs when invoked through a symlink, like an npm bin shim", () => {
  // Regression: `npm install -g` executes the CLI through a bin symlink,
  // while Node resolves the entry module to its real path. A naive
  // argv[1] comparison never matches, so the installed command would
  // print nothing and exit 0 — the worst possible failure mode.
  const link = join(tempDir(), "skillsmith");
  symlinkSync(CLI, link);
  const r = spawnSync(process.execPath, [link, "--version"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), JSON.parse(readFileSync(PKG, "utf8")).version);
});

test("--help documents every command; usage problems exit 2", () => {
  const r = runCli(["--help"]);
  assert.equal(r.code, 0);
  for (const word of ["new", "validate", "list", "info", "test", "--strict", "--json", "Exit codes"]) {
    assert.ok(r.stdout.includes(word), `--help missing ${word}`);
  }
  assert.equal(runCli([]).code, 2, "no command prints usage but exits 2");
  const unknown = runCli(["frobnicate"]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /unknown command "frobnicate"/);
  assert.equal(runCli(["validate", "--bogus"]).code, 2);
  assert.match(runCli(["validate", "--strict=yes"]).stderr, /takes no value/);
});

test("validate: healthy example exits 0 with the OK line", () => {
  const r = runCli(["validate", join(EXAMPLES, "changelog-draft")]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /changelog-draft: OK — 0 error\(s\), 0 warning\(s\)/);
  assert.match(r.stdout, /1 skill\(s\) checked, 0 with findings/);
});

test("validate: broken example exits 1 and renders lined diagnostics", () => {
  const r = runCli(["validate", join(EXAMPLES, "needs-work")]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /INVALID — 3 error\(s\), 6 warning\(s\)/);
  assert.match(r.stdout, /SKILL\.md:2 E_NAME_PATTERN/);
  assert.match(r.stdout, /did you mean `argument-hint`\?/);
  // --quiet keeps the verdict line and drops the detail.
  const quiet = runCli(["validate", join(EXAMPLES, "needs-work"), "--quiet"]);
  assert.match(quiet.stdout, /INVALID/);
  assert.ok(!quiet.stdout.includes("E_NAME_PATTERN"));
});

test("validate: a tree target discovers and checks every skill under it", () => {
  const r = runCli(["validate", EXAMPLES]);
  assert.equal(r.code, 1, "one bad skill fails the whole run");
  assert.match(r.stdout, /2 skill\(s\) checked, 1 with findings/);
});

test("validate: unreadable path exits 2 via stderr, not a stack trace", () => {
  const r = runCli(["validate", join(tempDir(), "ghost")]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /no such file or directory/);
  assert.ok(!r.stderr.includes("at "), "no stack trace for expected I/O errors");
});

test("validate --json emits parseable reports with codes intact", () => {
  const r = runCli(["validate", join(EXAMPLES, "needs-work"), "--json"]);
  assert.equal(r.code, 1);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.skills.length, 1);
  const codes = doc.skills[0].diagnostics.map((d) => d.code);
  assert.ok(codes.includes("E_BROKEN_REF"));
  assert.equal(doc.skills[0].ok, false);
});

test("the full author flow: new → validate 0 → --strict 1 → fix → --strict 0", () => {
  const cwd = tempDir();
  const created = runCli(["new", "triage-notes", "--hint", "[issue]"], { cwd });
  assert.equal(created.code, 0);
  assert.match(created.stdout, /created triage-notes/);

  assert.equal(runCli(["validate", "triage-notes"], { cwd }).code, 0, "fresh scaffold validates");
  assert.equal(runCli(["validate", "triage-notes", "--strict"], { cwd }).code, 1, "TODOs block --strict");

  // "Fix" the skill: real description, real body, real test prompt.
  const skillPath = join(cwd, "triage-notes", "SKILL.md");
  writeFileSync(
    skillPath,
    `---
name: triage-notes
description: >-
  Turns a bug report into structured triage notes. Use when the user pastes
  an issue and asks for triage, severity, or next steps.
argument-hint: "[issue]"
---

# triage-notes

Read the issue given as $ARGUMENTS and produce triage notes: severity,
suspected area, and the next concrete step. See
[references/README.md](references/README.md) for local conventions.
`,
  );
  writeFileSync(
    join(cwd, "triage-notes", "tests", "cases.yaml"),
    `skillsmith-tests: 1
cases:
  - name: crash-report
    prompt: Triage this crash report from the beta channel
    args: "crash on save"
    expect:
      output-contains: [severity]
`,
  );
  const strict = runCli(["validate", "triage-notes", "--strict"], { cwd });
  assert.equal(strict.code, 0, strict.stdout);
});

test("new: bad names and clobbering exit 2 with a reason", () => {
  const cwd = tempDir();
  const bad = runCli(["new", "Not_Valid"], { cwd });
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /not a valid skill name/);
  assert.equal(runCli(["new", "dup-skill"], { cwd }).code, 0);
  const dup = runCli(["new", "dup-skill"], { cwd });
  assert.equal(dup.code, 2);
  assert.match(dup.stderr, /--force/);
});

test("list renders both examples with verdicts; --json is machine-readable", () => {
  const human = runCli(["list", EXAMPLES]);
  assert.equal(human.code, 0);
  assert.match(human.stdout, /found 2 skill\(s\)/);
  assert.match(human.stdout, /ok\s+changelog-draft/);
  assert.match(human.stdout, /invalid Fix_Stuff/);
  const json = JSON.parse(runCli(["list", EXAMPLES, "--json"]).stdout);
  assert.deepEqual(json.skills.map((s) => s.ok), [true, false]);
});

test("info surfaces metadata, argument usage and case counts", () => {
  const r = runCli(["info", join(EXAMPLES, "changelog-draft")]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /name: {11}changelog-draft/);
  assert.match(r.stdout, /argument-hint: {2}\[revision-range\]/);
  assert.match(r.stdout, /arguments: {6}\$1/);
  assert.match(r.stdout, /test cases: {5}2/);
});

test("test: healthy example passes; a missing stub is a clean failure", () => {
  const pass = runCli(["test", join(EXAMPLES, "changelog-draft")]);
  assert.equal(pass.code, 0);
  assert.match(pass.stdout, /2 case\(s\), 10 static check\(s\)/);
  assert.match(pass.stdout, /OK — every case is well-formed/);
  const cwd = tempDir();
  runCli(["new", "no-stub", "--no-tests"], { cwd });
  const fail = runCli(["test", "no-stub"], { cwd });
  assert.equal(fail.code, 1);
  assert.match(fail.stdout, /E_NO_TESTS/);
  // --json reports cases, checks and failures machine-readably.
  const doc = JSON.parse(runCli(["test", join(EXAMPLES, "changelog-draft"), "--json"]).stdout);
  assert.deepEqual(
    { cases: doc.cases, checks: doc.checks, ok: doc.ok, failures: doc.failures },
    { cases: 2, checks: 10, ok: true, failures: [] },
  );
});
