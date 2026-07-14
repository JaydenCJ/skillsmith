// The YAML subset parser is the foundation every other layer stands on:
// if it misreads front-matter, every diagnostic downstream is wrong. These
// tests pin the accepted subset, the typed scalars, the line bookkeeping,
// and — just as deliberately — the constructs that must be REJECTED with a
// lined error instead of silently misparsed.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseYaml } from "../dist/yaml.js";

function ok(source) {
  const doc = parseYaml(source);
  assert.deepEqual(doc.errors, [], `expected no errors, got ${JSON.stringify(doc.errors)}`);
  return doc;
}

test("parses a flat mapping with typed scalars, CRLF included", () => {
  const doc = ok("name: demo\ncount: 42\nratio: 2.5\nenabled: true\nnothing: null\ntilde: ~");
  assert.deepEqual(doc.value, { name: "demo", count: 42, ratio: 2.5, enabled: true, nothing: null, tilde: null });
  // Windows line endings parse identically.
  const crlf = ok("name: demo\r\nlist:\r\n  - a\r\n  - b");
  assert.deepEqual(crlf.value, { name: "demo", list: ["a", "b"] });
});

test("quoted scalars stay strings and support escapes", () => {
  const doc = ok(`a: "42"\nb: 'true'\nc: "line\\nbreak"\nd: 'it''s'`);
  assert.deepEqual(doc.value, { a: "42", b: "true", c: "line\nbreak", d: "it's" });
});

test("nested mappings by indentation", () => {
  const doc = ok("metadata:\n  owner: platform\n  tier: 2");
  assert.deepEqual(doc.value, { metadata: { owner: "platform", tier: 2 } });
});

test("block sequences, including sequences of mappings", () => {
  const doc = ok("cases:\n  - name: one\n    prompt: first\n  - name: two\n    prompt: second");
  assert.deepEqual(doc.value, {
    cases: [
      { name: "one", prompt: "first" },
      { name: "two", prompt: "second" },
    ],
  });
});

test("a sequence may sit at the same indent as its key", () => {
  const doc = ok("tools:\n- Read\n- Edit");
  assert.deepEqual(doc.value, { tools: ["Read", "Edit"] });
});

test("flow sequences: quoted and nested items, empty [], empty values", () => {
  const doc = ok(`files: [references/style.md, "a, b.md", [1, 2]]`);
  assert.deepEqual(doc.value, { files: ["references/style.md", "a, b.md", [1, 2]] });
  const edge = ok("empty: []\nblank:");
  assert.deepEqual(edge.value, { empty: [], blank: null });
});

test("literal block scalar keeps newlines; folded joins them", () => {
  const lit = ok("text: |\n  line one\n  line two");
  assert.equal(lit.value.text, "line one\nline two\n");
  const folded = ok("text: >-\n  line one\n  line two\n\n  new para");
  assert.equal(folded.value.text, "line one line two\nnew para");
});

test("comments: ignored at block level and after scalars; # without a leading space is content", () => {
  const doc = ok("# leading comment\nname: demo # trailing\nlist: [a, b] # after flow");
  assert.deepEqual(doc.value, { name: "demo", list: ["a", "b"] });
  // YAML: comments require whitespace before '#'. "#aabbcc-ish" is a value.
  const hashes = ok("color: #aabbcc-ish\ntag: a#b");
  assert.deepEqual(hashes.value, { color: "#aabbcc-ish", tag: "a#b" });
});

test("keyLines maps every key path to its 1-based line; duplicates are lined errors", () => {
  const doc = ok("name: demo\nmetadata:\n  owner: me\ncases:\n  - name: one");
  assert.equal(doc.keyLines["name"], 1);
  assert.equal(doc.keyLines["metadata.owner"], 3);
  assert.equal(doc.keyLines["cases[0].name"], 5);
  const dup = parseYaml("name: a\nname: b");
  assert.equal(dup.errors.length, 1);
  assert.equal(dup.errors[0].line, 2);
  assert.match(dup.errors[0].message, /duplicate key "name"/);
});

test("unsupported constructs are rejected with clear errors, never misparsed", () => {
  for (const [source, pattern] of [
    ["value: &anchor x", /anchors/],
    ["value: *alias", /anchors|aliases/],
    ["value: !!str x", /tags/],
    ["value: {a: 1}", /flow mappings/],
    ['value: "never closed', /unterminated quoted/],
    ["value: [a, b", /unterminated flow/],
    ["name: demo\nmetadata:\n\towner: me", /tab/],
  ]) {
    const doc = parseYaml(source);
    assert.ok(doc.errors.some((e) => pattern.test(e.message)), `expected ${pattern} for ${JSON.stringify(source)}`);
  }
});

test("lines that are not key/value pairs are reported and skipped", () => {
  const doc = parseYaml("name: demo\njust some words\nlicense: MIT");
  assert.ok(doc.errors.some((e) => e.line === 2 && /expected "key: value"/.test(e.message)));
  assert.deepEqual(doc.value, { name: "demo", license: "MIT" });
});
