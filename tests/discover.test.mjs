// Skill discovery over a directory tree: what is found, what is skipped,
// and the no-nesting rule that keeps tests/fixtures inside a skill from
// being mistaken for more skills.
import { strict as assert } from "node:assert";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { discoverSkills } from "../dist/discover.js";
import { tempDir, writeSkill } from "./helpers.mjs";

test("finds skills at any depth, sorted by path", () => {
  const root = tempDir();
  writeSkill(join(root, "team-b"), "zeta-skill");
  writeSkill(root, "alpha-skill");
  writeSkill(join(root, "team-a", "deep"), "mid-skill");
  const found = discoverSkills(root).map((d) => d.slice(root.length + 1));
  assert.deepEqual(found, ["alpha-skill", join("team-a", "deep", "mid-skill"), join("team-b", "zeta-skill")]);
});

test("the root itself being a skill returns exactly that one", () => {
  const root = tempDir();
  const dir = writeSkill(root, "only-skill");
  writeSkill(dir, "nested-should-be-invisible");
  assert.deepEqual(discoverSkills(dir), [dir]);
});

test("dependency, build and hidden directories are never descended into", () => {
  const root = tempDir();
  writeSkill(join(root, "node_modules", "pkg"), "dep-skill");
  writeSkill(join(root, "dist"), "built-skill");
  writeSkill(join(root, ".hidden"), "secret-skill");
  writeSkill(root, "real-skill");
  const found = discoverSkills(root);
  assert.equal(found.length, 1);
  assert.ok(found[0].endsWith("real-skill"));
});

test("an empty or missing root yields an empty list, never a throw", () => {
  const empty = tempDir();
  mkdirSync(join(empty, "just-dirs", "no-skills"), { recursive: true });
  assert.deepEqual(discoverSkills(empty), []);
  assert.deepEqual(discoverSkills(join(empty, "does-not-exist")), []);
});
