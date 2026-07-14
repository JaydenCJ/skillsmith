// The front-matter schema: required fields, patterns, limits, tool-list
// normalization, and the did-you-mean suggestion for typo'd keys. Each
// test pins the exact diagnostic code — codes are public API.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateFrontmatter } from "../dist/schema.js";

const GOOD_DESC = "Does the thing. Use when the user asks for the thing to be done properly.";

function codes(result) {
  return result.diagnostics.map((d) => d.code).sort();
}

function validate(data, keyLines = {}) {
  return validateFrontmatter(data, keyLines);
}

test("a minimal valid mapping produces normalized meta and no diagnostics", () => {
  const result = validate({ name: "demo-skill", description: GOOD_DESC });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.meta, { name: "demo-skill", description: GOOD_DESC });
});

test("missing name and description are separate E_MISSING_FIELD errors", () => {
  const result = validate({});
  assert.deepEqual(codes(result), ["E_MISSING_FIELD", "E_MISSING_FIELD"]);
  assert.equal(result.meta, null);
});

test("non-mapping front-matter is E_FRONTMATTER_TYPE", () => {
  for (const bad of [null, ["a"], "text"]) {
    assert.deepEqual(codes(validate(bad)), ["E_FRONTMATTER_TYPE"]);
  }
});

test("name violations: pattern breaks and the 64-char limit, anchored to the name line", () => {
  for (const bad of ["Fix_Stuff", "UPPER", "has space", "double--hyphen", "-lead", "trail-", "café"]) {
    const result = validate({ name: bad, description: GOOD_DESC });
    assert.ok(codes(result).includes("E_NAME_PATTERN"), `expected E_NAME_PATTERN for "${bad}"`);
  }
  const long = validate({ name: "a".repeat(65), description: GOOD_DESC }, { name: 2 });
  const diag = long.diagnostics.find((d) => d.code === "E_NAME_LENGTH");
  assert.ok(diag);
  assert.equal(diag.line, 2);
});

test("description over 1024 characters is E_DESC_LENGTH", () => {
  const long = `Use when needed. ${"x".repeat(1024)}`;
  assert.ok(codes(validate({ name: "demo", description: long })).includes("E_DESC_LENGTH"));
});

test("short and trigger-less descriptions warn, not error; 'whenever' satisfies the trigger heuristic", () => {
  const result = validate({ name: "demo", description: "Fixes stuff." });
  assert.deepEqual(codes(result), ["W_DESC_NO_TRIGGER", "W_DESC_SHORT"]);
  assert.ok(result.meta, "warnings still yield usable meta");
  const whenever = "Reformats tables in place. Trigger it whenever a markdown table looks ragged.";
  assert.deepEqual(codes(validate({ name: "demo", description: whenever })), []);
});

test("allowed-tools: comma-separated string and YAML list both normalize; malformed entries warn", () => {
  const fromString = validate({ name: "demo", description: GOOD_DESC, "allowed-tools": "Bash(git log:*), Read , Edit" });
  assert.deepEqual(fromString.meta.allowedTools, ["Bash(git log:*)", "Read", "Edit"]);
  assert.deepEqual(fromString.diagnostics, []);
  const fromList = validate({ name: "demo", description: GOOD_DESC, "allowed-tools": ["Read", "not a tool!!"] });
  assert.deepEqual(fromList.meta.allowedTools, ["Read", "not a tool!!"]);
  assert.deepEqual(codes(fromList), ["W_TOOL_PATTERN"]);
});

test("wrong types are E_TYPE with the field named", () => {
  const result = validate({
    name: 5,
    description: GOOD_DESC,
    model: [],
    "disable-model-invocation": "yes",
    metadata: "flat",
  });
  const typeErrors = result.diagnostics.filter((d) => d.code === "E_TYPE");
  assert.equal(typeErrors.length, 4);
  const mentioned = typeErrors.map((d) => d.message).join("\n");
  for (const field of ["name", "model", "disable-model-invocation", "metadata"]) {
    assert.ok(mentioned.includes(`\`${field}\``), `E_TYPE should name ${field}`);
  }
  // Empty strings are rejected too, not silently accepted.
  assert.deepEqual(codes(validate({ name: "demo", description: GOOD_DESC, model: "  " })), ["E_TYPE"]);
});

test("metadata scalars are normalized to strings; nested values are E_TYPE", () => {
  const good = validate({ name: "demo", description: GOOD_DESC, metadata: { tier: 2, on: true } });
  assert.deepEqual(good.meta.metadata, { tier: "2", on: "true" });
  const bad = validate({ name: "demo", description: GOOD_DESC, metadata: { deep: { a: 1 } } });
  assert.ok(codes(bad).includes("E_TYPE"));
});

test("unknown keys warn — with a did-you-mean only when close — and x- extensions never warn", () => {
  const typo = validate({ name: "demo", description: GOOD_DESC, argument_hint: "[x]" }, { argument_hint: 4 });
  const suggestion = typo.diagnostics.find((d) => d.code === "W_UNKNOWN_KEY");
  assert.ok(suggestion);
  assert.match(suggestion.message, /did you mean `argument-hint`\?/);
  assert.equal(suggestion.line, 4);
  const far = validate({ name: "demo", description: GOOD_DESC, banana: 1 });
  const bare = far.diagnostics.find((d) => d.code === "W_UNKNOWN_KEY");
  assert.ok(bare);
  assert.ok(!/did you mean/.test(bare.message), bare.message);
  assert.deepEqual(validate({ name: "demo", description: GOOD_DESC, "x-internal-rank": 3 }).diagnostics, []);
});

