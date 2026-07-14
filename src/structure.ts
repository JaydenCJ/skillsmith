/**
 * Directory-level checks: do the files the body points at exist, does the
 * skill carry files the body never mentions, do bundled scripts start with
 * a shebang, and does the folder name agree with the front-matter name.
 * Reference EXTRACTION is pure (unit-testable on strings); only the
 * existence checks touch the filesystem.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { Diagnostic, err, warn } from "./diagnostics.js";

export interface BodyReference {
  /** Referenced path, normalized (no leading `./`, no fragment). */
  target: string;
  /** 1-based file line where the reference appears. */
  line: number;
}

const MD_LINK = /!?\[[^\]]*\]\(([^()\s]+)(?:\s+"[^"]*")?\)/g;
const CODE_SPAN = /`([^`\n]+)`/g;
/** Code-span tokens that clearly point inside the skill directory. */
const PATHY_SPAN = /^(?:\.\/)?(?:references|scripts|assets|templates|examples|tests)\/[A-Za-z0-9_./-]+$/;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Extract relative file references from a markdown body. */
export function extractReferences(body: string, lineOffset = 1): BodyReference[] {
  const refs: BodyReference[] = [];
  const seen = new Set<string>();
  const push = (raw: string, line: number): void => {
    let target = raw.split("#")[0] as string;
    if (target.startsWith("./")) target = target.slice(2);
    if (target === "" || seen.has(target)) return;
    seen.add(target);
    refs.push({ target, line });
  };
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const fileLine = lineOffset + i;
    for (const match of line.matchAll(MD_LINK)) {
      const target = match[1] as string;
      if (URL_SCHEME.test(target)) continue; // https:, mailto:, ...
      if (target.startsWith("#") || target.startsWith("/")) continue;
      push(target, fileLine);
    }
    for (const match of line.matchAll(CODE_SPAN)) {
      const content = (match[1] as string).trim();
      if (PATHY_SPAN.test(content)) push(content, fileLine);
    }
  }
  return refs;
}

export interface StructureOptions {
  /** Skill front-matter name, for the directory-name check. */
  name?: string;
  /** Skip the name/directory agreement check (file-only validation). */
  skipNameCheck?: boolean;
}

/** List files under `dir` recursively, as `/`-joined relative paths. */
function walkFiles(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries.sort()) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

const SCRIPT_EXTENSIONS = new Set(["sh", "bash", "py", "js", "mjs", "rb", "pl", ""]);

/**
 * Run the filesystem checks for a skill rooted at `skillDir`.
 *
 * @param body Markdown body of SKILL.md (for reference existence and
 *             the unreferenced-file sweep).
 */
export function checkStructure(
  skillDir: string,
  body: string,
  options: StructureOptions = {},
  bodyLineOffset = 1,
): Diagnostic[] {
  const diags: Diagnostic[] = [];

  // 1. Front-matter name must match the folder the skill ships in —
  //    runtimes key skills by directory name and mismatches shadow silently.
  const dirName = skillDir.split(sep).filter((p) => p !== "").pop() ?? "";
  if (!options.skipNameCheck && options.name !== undefined && options.name !== dirName) {
    diags.push(
      err("E_NAME_MISMATCH", `front-matter name "${options.name}" does not match directory name "${dirName}"`, {
        file: "SKILL.md",
      }),
    );
  }

  // 2. Every relative path the body references must exist.
  const refs = extractReferences(body, bodyLineOffset);
  for (const ref of refs) {
    if (ref.target.split("/").includes("..")) {
      diags.push(
        err("E_BROKEN_REF", `reference "${ref.target}" escapes the skill directory`, { file: "SKILL.md", line: ref.line }),
      );
      continue;
    }
    if (!existsSync(join(skillDir, ...ref.target.split("/")))) {
      diags.push(
        err("E_BROKEN_REF", `body references "${ref.target}" but the file does not exist`, { file: "SKILL.md", line: ref.line }),
      );
    }
  }

  // 3. Files the skill carries but the body never mentions are dead weight
  //    the agent will never load (tests/ is exempt: it is for humans).
  const allFiles = walkFiles(skillDir);
  const referenced = new Set(refs.map((r) => r.target));
  for (const file of allFiles) {
    if (file === "SKILL.md" || file.startsWith("tests/")) continue;
    if (referenced.has(file) || body.includes(file)) continue;
    diags.push(warn("W_UNREFERENCED_FILE", `"${file}" is bundled but SKILL.md never references it`, { file }));
  }

  // 4. Bundled scripts should be directly runnable.
  const scriptsDir = join(skillDir, "scripts");
  if (existsSync(scriptsDir) && statSync(scriptsDir).isDirectory()) {
    for (const script of walkFiles(scriptsDir)) {
      const ext = script.includes(".") ? (script.split(".").pop() as string) : "";
      if (!SCRIPT_EXTENSIONS.has(ext)) continue;
      const head = readFileSync(join(scriptsDir, ...script.split("/")), "utf8").slice(0, 2);
      if (head !== "#!") {
        diags.push(
          warn("W_SCRIPT_NO_SHEBANG", `scripts/${script} has no shebang line; agents run scripts directly`, {
            file: `scripts/${script}`,
            line: 1,
          }),
        );
      }
    }
  }

  // 5. Skills do not nest: an inner SKILL.md is invisible to every runtime.
  for (const file of allFiles) {
    if (file !== "SKILL.md" && file.endsWith("/SKILL.md")) {
      diags.push(warn("W_NESTED_SKILL", `nested skill at "${file}" will not be discovered; move it to a sibling directory`, { file }));
    }
  }

  // 6. A skill without a test stub is a skill nobody can regression-check.
  if (!existsSync(join(skillDir, "tests", "cases.yaml"))) {
    diags.push(warn("W_NO_TESTS", "no tests/cases.yaml; scaffold one with `skillsmith new` or write it by hand"));
  }

  return diags;
}
