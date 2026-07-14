// The tests/cases.yaml stub format: parsing, shape errors, and the
// offline cross-checks against the skill (shipped files, argument arity).
// This is where stub rot gets caught before an eval run burns tokens on it.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { checkTestSpec, parseTestSpec } from "../dist/testspec.js";
import { analyzeArguments } from "../dist/args.js";
import { tempDir, writeSkill, CASES_YAML } from "./helpers.mjs";

function codes(diags) {
  return diags.map((d) => d.code).sort();
}

test("parses a well-formed spec into typed cases", () => {
  const result = parseTestSpec(CASES_YAML);
  assert.deepEqual(codes(result.diagnostics), []);
  assert.equal(result.spec.version, 1);
  assert.deepEqual(result.spec.cases, [
    {
      name: "basic",
      prompt: "Run the demo behavior against the main branch",
      args: "main",
      expect: { outputContains: ["demo"] },
    },
  ]);
});

test("missing or future version markers are E_TESTSPEC_VERSION, never guessed at", () => {
  const missing = parseTestSpec("cases:\n  - name: a\n    prompt: p\n");
  assert.deepEqual(codes(missing.diagnostics), ["E_TESTSPEC_VERSION"]);
  assert.equal(missing.spec, null);
  const future = parseTestSpec("skillsmith-tests: 2\ncases: []\n");
  assert.equal(future.diagnostics[0].code, "E_TESTSPEC_VERSION");
  assert.match(future.diagnostics[0].message, /version 2/);
});

test("empty or missing cases list is E_TESTSPEC", () => {
  for (const source of ["skillsmith-tests: 1\n", "skillsmith-tests: 1\ncases: []\n"]) {
    assert.deepEqual(codes(parseTestSpec(source).diagnostics), ["E_TESTSPEC"]);
  }
});

test("cases without name or prompt are E_CASE_FIELD; valid siblings survive", () => {
  const source = `skillsmith-tests: 1
cases:
  - prompt: has no name
  - name: no-prompt
  - name: fine
    prompt: has both
`;
  const result = parseTestSpec(source);
  const fieldErrors = result.diagnostics.filter((d) => d.code === "E_CASE_FIELD");
  assert.equal(fieldErrors.length, 2);
  assert.deepEqual(result.spec.cases.map((c) => c.name), ["fine"]);
});

test("case names must be lowercase slugs and unique", () => {
  const source = `skillsmith-tests: 1
cases:
  - name: Bad Name
    prompt: p
  - name: twice
    prompt: p
  - name: twice
    prompt: p
`;
  const result = parseTestSpec(source);
  assert.ok(codes(result.diagnostics).includes("E_CASE_FIELD"));
  assert.ok(codes(result.diagnostics).includes("E_DUPLICATE_CASE"));
});

test("TODO prompts warn W_CASE_TODO with the prompt's line", () => {
  const source = `skillsmith-tests: 1
cases:
  - name: stub
    prompt: "TODO: fill this in"
`;
  const result = parseTestSpec(source);
  const todo = result.diagnostics.find((d) => d.code === "W_CASE_TODO");
  assert.ok(todo);
  assert.equal(todo.line, 4);
});

test("expect must be a mapping of string lists; unknown keys warn", () => {
  const source = `skillsmith-tests: 1
cases:
  - name: bad-expect
    prompt: p
    expect: [not, a, mapping]
  - name: bad-files
    prompt: p
    expect:
      files: [3]
  - name: extra
    prompt: p
    expect:
      output-contains: [ok]
      exit-code: 0
`;
  const result = parseTestSpec(source);
  assert.equal(result.diagnostics.filter((d) => d.code === "E_CASE_TYPE").length, 2);
  assert.equal(result.diagnostics.filter((d) => d.code === "W_CASE_UNKNOWN_KEY").length, 1);
});

test("cross-check: E_CASE_FILE when an expected file does not ship or escapes", () => {
  const dir = writeSkill(tempDir(), "demo-skill", { files: { "references/real.md": "x" } });
  const spec = {
    version: 1,
    cases: [
      { name: "ships", prompt: "p", expect: { files: ["references/real.md"] } },
      { name: "missing", prompt: "p", expect: { files: ["references/gone.md"] } },
      { name: "escape", prompt: "p", expect: { files: ["../outside.md"] } },
    ],
  };
  const diags = checkTestSpec(spec, { dir, meta: null, usage: analyzeArguments("") });
  assert.deepEqual(codes(diags), ["E_CASE_FILE", "E_CASE_FILE"]);
});

test("cross-check: W_CASE_ARITY only for non-empty args with too few words", () => {
  const dir = writeSkill(tempDir(), "demo-skill");
  const usage = analyzeArguments("uses $1 and $2");
  const spec = {
    version: 1,
    cases: [
      { name: "enough", prompt: "p", args: "one two" },
      { name: "short", prompt: "p", args: "one" },
      { name: "no-arg-path", prompt: "p", args: "" },
    ],
  };
  const diags = checkTestSpec(spec, { dir, meta: null, usage });
  const arity = diags.filter((d) => d.code === "W_CASE_ARITY");
  assert.equal(arity.length, 1);
  assert.match(arity[0].message, /"short"/);
});

test("cross-check: W_CASE_NO_ARGS when the skill consumes args but a case omits them", () => {
  const dir = writeSkill(tempDir(), "demo-skill");
  const usage = analyzeArguments("takes $ARGUMENTS");
  const spec = { version: 1, cases: [{ name: "bare", prompt: "p" }] };
  const diags = checkTestSpec(spec, { dir, meta: null, usage });
  assert.deepEqual(codes(diags).filter((c) => c !== "W_CASE_ARITY"), ["W_CASE_NO_ARGS"]);
  // Numeric args coerce to strings so `args: 42` still works.
  const numeric = parseTestSpec("skillsmith-tests: 1\ncases:\n  - name: numeric\n    prompt: p\n    args: 42\n");
  assert.equal(numeric.spec.cases[0].args, "42");
});
