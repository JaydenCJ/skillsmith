// Shared helpers: a child-process CLI runner, temp skill factories, and
// paths. Everything is deterministic and offline — temp dirs come from
// mkdtemp and are removed when the process exits.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PKG = join(ROOT, "package.json");
export const CLI = join(ROOT, "dist", "cli.js");
export const EXAMPLES = join(ROOT, "examples");

const created = [];
process.on("exit", () => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/** Fresh temp directory, cleaned up on process exit. */
export function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "skillsmith-test-"));
  created.push(dir);
  return dir;
}

/** Run the compiled CLI; returns { code, stdout, stderr }. */
export function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: options.cwd ?? ROOT,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Minimal valid SKILL.md source with overridable front-matter lines. */
export function skillSource({
  name = "demo-skill",
  description = "Does a demo thing. Use when the user asks for the demo behavior in tests.",
  extraFrontmatter = [],
  body = "\n# demo-skill\n\nFollow the demo instructions carefully and answer in one paragraph.\n",
} = {}) {
  const fm = ["---", `name: ${name}`, `description: ${JSON.stringify(description)}`, ...extraFrontmatter, "---"];
  return fm.join("\n") + "\n" + body;
}

/** Write a skill directory into `parent`; returns its path. */
export function writeSkill(parent, name, { source, files = {} } = {}) {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), source ?? skillSource({ name }));
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, ...rel.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

/** A well-formed tests/cases.yaml for skills that consume $1. */
export const CASES_YAML = `skillsmith-tests: 1
cases:
  - name: basic
    prompt: Run the demo behavior against the main branch
    args: "main"
    expect:
      output-contains: ["demo"]
`;
