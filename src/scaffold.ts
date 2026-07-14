/**
 * `skillsmith new` — write a skill directory that validates cleanly from
 * the first second. The scaffold is opinionated: front-matter with a
 * trigger-shaped description, a body with the sections agents actually
 * read, and a test stub so the skill is checkable before it is clever.
 * TODO markers are left in on purpose: `validate` passes, `--strict`
 * refuses to ship them.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { NAME_MAX_LENGTH, NAME_PATTERN } from "./schema.js";

export interface ScaffoldOptions {
  /** Skill name; becomes the directory name and front-matter `name`. */
  name: string;
  /** Parent directory the skill folder is created in (default "."). */
  dir?: string;
  /** Real description; a TODO-marked template is used when omitted. */
  description?: string;
  /** `argument-hint` value; enables $ARGUMENTS wiring in the body. */
  hint?: string;
  /** `allowed-tools` entries. */
  tools?: string[];
  /** `model` override. */
  model?: string;
  /** `license` identifier. */
  license?: string;
  /** Skip the tests/cases.yaml stub. */
  noTests?: boolean;
  /** Write into a non-empty existing directory. */
  force?: boolean;
}

export interface ScaffoldResult {
  /** Absolute path of the created skill directory. */
  dir: string;
  /** Files written, relative to `dir`. */
  files: string[];
}

/** Error with a stable `code` so the CLI can map it to an exit code. */
export class ScaffoldError extends Error {
  constructor(
    message: string,
    readonly code: "E_BAD_NAME" | "E_EXISTS",
  ) {
    super(message);
    this.name = "ScaffoldError";
  }
}

/** YAML-quote a scalar defensively (always double-quoted). */
function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Render the SKILL.md the scaffold writes. Exported for tests. */
export function renderSkillMd(options: ScaffoldOptions): string {
  const description =
    options.description ?? "TODO: one sentence on what this skill does, then when to use it (e.g. \"Use when the user asks to ...\").";
  const fm: string[] = ["---", `name: ${options.name}`, "description: >-"];
  for (const line of wrap(description, 72)) fm.push(`  ${line}`);
  if (options.hint !== undefined) fm.push(`argument-hint: ${quote(options.hint)}`);
  if (options.tools !== undefined && options.tools.length > 0) {
    fm.push(`allowed-tools: ${options.tools.join(", ")}`);
  }
  if (options.model !== undefined) fm.push(`model: ${options.model}`);
  if (options.license !== undefined) fm.push(`license: ${options.license}`);
  fm.push("---");

  const argsLine =
    options.hint !== undefined
      ? "The invocation arguments arrive as $ARGUMENTS."
      : "This skill takes no invocation arguments.";
  const body = `
# ${options.name}

TODO: instructions the agent follows once this skill triggers. Write them
to the agent, in the imperative. ${argsLine}

## Steps

1. TODO: the first concrete step.
2. TODO: the next one. Link supporting material (see
   [references/README.md](references/README.md)) so it loads only on demand.

## Output

TODO: describe what a good result looks like — format, tone, length.
`;
  return fm.join("\n") + "\n" + body.replace(/^\n/, "\n");
}

/** Render the tests/cases.yaml stub. Exported for tests. */
export function renderTestStub(options: ScaffoldOptions): string {
  const lines: string[] = [
    "# Test stub for the skill — checked offline by `skillsmith test`.",
    "# Each case is a realistic prompt that should trigger the skill, the",
    "# arguments it runs with, and what a good result must contain.",
    "skillsmith-tests: 1",
    "cases:",
    "  - name: happy-path",
    "    prompt: \"TODO: a realistic user request that should trigger this skill\"",
  ];
  if (options.hint !== undefined) {
    lines.push(`    args: "TODO: example ${options.hint} value"`);
  }
  lines.push("    expect:", "      output-contains:", "        - \"TODO: a string every good answer includes\"");
  return lines.join("\n") + "\n";
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter((w) => w !== "");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current === "") current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/** Create the skill directory. Throws `ScaffoldError` on refusals. */
export function scaffoldSkill(options: ScaffoldOptions): ScaffoldResult {
  const name = options.name;
  if (!NAME_PATTERN.test(name) || name.length > NAME_MAX_LENGTH) {
    throw new ScaffoldError(
      `"${name}" is not a valid skill name (lowercase letters, digits and single hyphens, max ${NAME_MAX_LENGTH} chars)`,
      "E_BAD_NAME",
    );
  }
  const dir = resolve(options.dir ?? ".", name);
  if (existsSync(dir) && readdirSync(dir).length > 0 && options.force !== true) {
    throw new ScaffoldError(`${dir} already exists and is not empty (use --force to write anyway)`, "E_EXISTS");
  }
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "references"), { recursive: true });
  const files: string[] = [];

  writeFileSync(join(dir, "SKILL.md"), renderSkillMd(options));
  files.push("SKILL.md");
  writeFileSync(
    join(dir, "references", "README.md"),
    "Put supporting material here (style guides, format specs, long tables)\nand link it from SKILL.md so agents load it only when needed.\n",
  );
  files.push("references/README.md");
  if (options.noTests !== true) {
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "cases.yaml"), renderTestStub(options));
    files.push("tests/cases.yaml");
  }
  return { dir, files };
}
