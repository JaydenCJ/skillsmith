// Fence handling: SKILL.md is front-matter between `---` fences plus a
// body, and every downstream line number depends on this module mapping
// YAML-relative lines back into file coordinates correctly.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseFrontmatter } from "../dist/frontmatter.js";

test("splits front-matter and body, mapping key lines into file coordinates", () => {
  const result = parseFrontmatter("---\nname: demo\ndescription: hi\n---\n\n# Body\n");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.data, { name: "demo", description: "hi" });
  assert.equal(result.keyLines["name"], 2, "yaml line 1 is file line 2");
  assert.equal(result.keyLines["description"], 3);
  assert.equal(result.bodyLine, 5);
  assert.equal(result.body, "\n# Body\n");
  // `...` closes the front-matter like `---`.
  const dots = parseFrontmatter("---\nname: demo\ndescription: hi\n...\nbody here");
  assert.deepEqual(dots.diagnostics, []);
  assert.equal(dots.body, "body here");
});

test("no opening fence on line 1 — including a leading blank — is E_NO_FRONTMATTER", () => {
  const result = parseFrontmatter("# Just markdown\n");
  assert.equal(result.diagnostics[0].code, "E_NO_FRONTMATTER");
  assert.equal(result.diagnostics[0].line, 1);
  assert.equal(result.body, "# Just markdown\n");
  assert.equal(parseFrontmatter("\n---\nname: demo\n---\nbody").diagnostics[0].code, "E_NO_FRONTMATTER");
});

test("a UTF-8 BOM before the fence IS tolerated", () => {
  const result = parseFrontmatter("﻿---\nname: demo\ndescription: hi\n---\nbody");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.data, { name: "demo", description: "hi" });
});

test("an unclosed fence is E_UNCLOSED_FRONTMATTER", () => {
  const result = parseFrontmatter("---\nname: demo\ndescription: hi\n");
  assert.equal(result.diagnostics[0].code, "E_UNCLOSED_FRONTMATTER");
  assert.equal(result.body, "");
});

test("YAML errors inside the front-matter surface as lined E_YAML", () => {
  const result = parseFrontmatter("---\nname: demo\nbroken line here\ndescription: hi\n---\nbody");
  const yaml = result.diagnostics.filter((d) => d.code === "E_YAML");
  assert.equal(yaml.length, 1);
  assert.equal(yaml[0].line, 3, "error points at the file line, not the yaml-relative one");
});

test("an empty front-matter block parses to null data without fence errors", () => {
  const result = parseFrontmatter("---\n---\nbody");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.data, null);
  assert.equal(result.body, "body");
});
