// Reference extraction (pure) and the filesystem structure checks:
// broken links, dead-weight files, shebang-less scripts, nested skills,
// and the name/directory agreement rule.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { checkStructure, extractReferences } from "../dist/structure.js";
import { tempDir, writeSkill } from "./helpers.mjs";

test("extracts markdown links and images, skipping URLs, anchors and absolute paths", () => {
  const body = [
    "See [style](references/style.md) and ![img](assets/pic.png).",
    "Not these: [web](https://example.test/x), [anchor](#top), [abs](/etc/hosts), [mail](mailto:a@example.test).",
  ].join("\n");
  const refs = extractReferences(body);
  assert.deepEqual(refs.map((r) => r.target), ["references/style.md", "assets/pic.png"]);
  // ./ prefixes and #fragments normalize, duplicates collapse, lines are offset.
  const dedup = extractReferences("[a](./references/a.md#section)\n[a again](references/a.md)", 7);
  assert.deepEqual(dedup, [{ target: "references/a.md", line: 7 }]);
});

test("extracts path-shaped code spans from conventional directories only", () => {
  const body = "Run `scripts/setup.sh`, read `references/format.md`, ignore `foo/bar.md` and `npm test`.";
  const refs = extractReferences(body).map((r) => r.target);
  assert.deepEqual(refs, ["scripts/setup.sh", "references/format.md"]);
});


test("E_BROKEN_REF for missing targets; silent when the file exists", () => {
  const dir = writeSkill(tempDir(), "demo-skill", {
    files: { "references/real.md": "content" },
  });
  const diags = checkStructure(dir, "[ok](references/real.md) and [gone](references/gone.md)", { name: "demo-skill" });
  const broken = diags.filter((d) => d.code === "E_BROKEN_REF");
  assert.equal(broken.length, 1);
  assert.match(broken[0].message, /references\/gone\.md/);
});

test("references that escape the skill directory are E_BROKEN_REF even if the file exists", () => {
  const parent = tempDir();
  const dir = writeSkill(parent, "demo-skill");
  const diags = checkStructure(dir, "[escape](../demo-skill/SKILL.md)", { name: "demo-skill" });
  const broken = diags.filter((d) => d.code === "E_BROKEN_REF");
  assert.equal(broken.length, 1);
  assert.match(broken[0].message, /escapes the skill directory/);
});

test("W_UNREFERENCED_FILE for bundled files the body never mentions; tests/ is exempt", () => {
  const dir = writeSkill(tempDir(), "demo-skill", {
    files: {
      "references/used.md": "x",
      "references/dead.md": "x",
      "tests/cases.yaml": "skillsmith-tests: 1\ncases:\n  - name: a\n    prompt: p\n",
    },
  });
  const diags = checkStructure(dir, "see [used](references/used.md)", { name: "demo-skill" });
  const dead = diags.filter((d) => d.code === "W_UNREFERENCED_FILE");
  assert.deepEqual(dead.map((d) => d.file), ["references/dead.md"]);
  // A plain-text mention counts as referencing the file.
  const prose = writeSkill(tempDir(), "demo-skill", { files: { "assets/logo.svg": "<svg/>" } });
  const proseDiags = checkStructure(prose, "The hero image lives at assets/logo.svg.", { name: "demo-skill" });
  assert.ok(!proseDiags.some((d) => d.code === "W_UNREFERENCED_FILE"));
});

test("W_SCRIPT_NO_SHEBANG for shell scripts without #!, silent with one", () => {
  const dir = writeSkill(tempDir(), "demo-skill", {
    files: {
      "scripts/good.sh": "#!/usr/bin/env bash\necho ok\n",
      "scripts/bad.sh": "echo no shebang\n",
    },
  });
  const body = "run `scripts/good.sh` and `scripts/bad.sh`";
  const diags = checkStructure(dir, body, { name: "demo-skill" });
  const shebang = diags.filter((d) => d.code === "W_SCRIPT_NO_SHEBANG");
  assert.deepEqual(shebang.map((d) => d.file), ["scripts/bad.sh"]);
});

test("E_NAME_MISMATCH when front-matter name and directory disagree, skippable for bare files", () => {
  const dir = writeSkill(tempDir(), "actual-dir");
  const strict = checkStructure(dir, "body", { name: "other-name" });
  assert.ok(strict.some((d) => d.code === "E_NAME_MISMATCH"));
  const relaxed = checkStructure(dir, "body", { name: "other-name", skipNameCheck: true });
  assert.ok(!relaxed.some((d) => d.code === "E_NAME_MISMATCH"));
});

test("W_NESTED_SKILL for a SKILL.md hiding inside the skill", () => {
  const dir = writeSkill(tempDir(), "demo-skill", {
    files: { "inner/SKILL.md": "---\nname: inner\ndescription: hidden\n---\nbody" },
  });
  const diags = checkStructure(dir, "mentions inner/SKILL.md so it is 'referenced'", { name: "demo-skill" });
  assert.ok(diags.some((d) => d.code === "W_NESTED_SKILL" && d.file === "inner/SKILL.md"));
});

test("W_NO_TESTS exactly when tests/cases.yaml is absent", () => {
  const bare = writeSkill(tempDir(), "demo-skill");
  assert.ok(checkStructure(bare, "body", { name: "demo-skill" }).some((d) => d.code === "W_NO_TESTS"));
  const covered = writeSkill(tempDir(), "demo-skill", { files: { "tests/cases.yaml": "skillsmith-tests: 1\ncases: []\n" } });
  assert.ok(!checkStructure(covered, "body", { name: "demo-skill" }).some((d) => d.code === "W_NO_TESTS"));
});
