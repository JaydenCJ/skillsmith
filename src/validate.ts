/**
 * The validation pipeline. `validateSkillSource` runs every pure layer
 * (fences → YAML → schema → arguments → body hygiene) on a string;
 * `validateSkill` adds the filesystem layers (structure, references,
 * test stubs) for a skill on disk. Reports aggregate diagnostics from all
 * layers and never throw on bad input — unreadable paths are the only
 * hard failure.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { analyzeArguments, ArgUsage, checkArguments } from "./args.js";
import { Diagnostic, err, errorCount, sortDiagnostics, warn, warningCount } from "./diagnostics.js";
import { parseFrontmatter } from "./frontmatter.js";
import { SkillMeta, validateFrontmatter } from "./schema.js";
import { checkStructure } from "./structure.js";
import { checkTestSpec, parseTestSpec, TESTSPEC_FILE, TestSpec } from "./testspec.js";

export const BODY_MAX_LINES = 500;
const PLACEHOLDER = /\b(?:TODO|FIXME|TBD)\b/;

export interface SkillReport {
  /** Path the caller asked about (as given). */
  target: string;
  /** Resolved skill directory, or null when validating a bare file. */
  skillDir: string | null;
  /** Front-matter name when parseable. */
  name: string | null;
  meta: SkillMeta | null;
  usage: ArgUsage;
  /** Parsed test spec when tests/cases.yaml exists and parses. */
  testSpec: TestSpec | null;
  diagnostics: Diagnostic[];
  errors: number;
  warnings: number;
  /** True when no error-severity diagnostics were produced. */
  ok: boolean;
}

function finishReport(partial: Omit<SkillReport, "diagnostics" | "errors" | "warnings" | "ok">, diags: Diagnostic[]): SkillReport {
  const diagnostics = sortDiagnostics(diags);
  const errors = errorCount(diagnostics);
  return { ...partial, diagnostics, errors, warnings: warningCount(diagnostics), ok: errors === 0 };
}

/** Pure layers only — ideal for editors and unit tests. */
export function validateSkillSource(source: string, file = "SKILL.md"): SkillReport {
  const diags: Diagnostic[] = [];
  const fm = parseFrontmatter(source, file);
  diags.push(...fm.diagnostics);

  let meta: SkillMeta | null = null;
  if (!fm.diagnostics.some((d) => d.code === "E_NO_FRONTMATTER" || d.code === "E_UNCLOSED_FRONTMATTER")) {
    const schema = validateFrontmatter(fm.data, fm.keyLines, file);
    diags.push(...schema.diagnostics);
    meta = schema.meta;
  }

  const usage = analyzeArguments(fm.body, fm.bodyLine);
  if (meta !== null) {
    diags.push(...checkArguments(meta, usage, file, fm.keyLines["argument-hint"]));
  }

  // Body hygiene.
  if (fm.body.trim() === "") {
    diags.push(err("E_EMPTY_BODY", "the body after the front-matter is empty; a skill with no instructions does nothing", { file }));
  } else {
    const lines = fm.body.split("\n");
    if (lines.length > BODY_MAX_LINES) {
      diags.push(
        warn("W_BODY_LONG", `body is ${lines.length} lines (> ${BODY_MAX_LINES}); move detail into references/ files loaded on demand`, {
          file,
          line: fm.bodyLine,
        }),
      );
    }
    for (let i = 0; i < lines.length; i++) {
      if (PLACEHOLDER.test(lines[i] as string)) {
        diags.push(warn("W_PLACEHOLDER", "leftover TODO/FIXME/TBD placeholder", { file, line: fm.bodyLine + i }));
      }
    }
    if (PLACEHOLDER.test(meta?.description ?? "")) {
      diags.push(warn("W_PLACEHOLDER", "leftover TODO/FIXME/TBD placeholder in `description`", { file, line: fm.keyLines["description"] }));
    }
  }

  return finishReport(
    { target: file, skillDir: null, name: meta?.name ?? null, meta, usage, testSpec: null },
    diags,
  );
}

/**
 * Validate a skill on disk. `target` may be a skill directory or a path to
 * its SKILL.md. Throws `Error` only when the target cannot be read at all.
 */
export function validateSkill(target: string): SkillReport {
  const resolved = resolve(target);
  let skillFile: string;
  let skillDir: string;
  let fileOnly = false;
  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    skillDir = resolved;
    skillFile = join(resolved, "SKILL.md");
    if (!existsSync(skillFile)) {
      throw new Error(`${target}: no SKILL.md in directory`);
    }
  } else if (existsSync(resolved)) {
    skillFile = resolved;
    skillDir = dirname(resolved);
    fileOnly = basename(resolved) !== "SKILL.md";
  } else {
    throw new Error(`${target}: no such file or directory`);
  }

  const source = readFileSync(skillFile, "utf8");
  const base = validateSkillSource(source, "SKILL.md");
  const diags = [...base.diagnostics];

  const fm = parseFrontmatter(source);
  diags.push(
    ...checkStructure(skillDir, fm.body, { name: base.meta?.name, skipNameCheck: fileOnly }, fm.bodyLine),
  );

  // Test stub: parse + cross-check when present (absence is already W_NO_TESTS).
  let testSpec: TestSpec | null = null;
  const specPath = join(skillDir, "tests", "cases.yaml");
  if (existsSync(specPath)) {
    const parsed = parseTestSpec(readFileSync(specPath, "utf8"));
    diags.push(...parsed.diagnostics);
    testSpec = parsed.spec;
    if (parsed.spec !== null) {
      diags.push(...checkTestSpec(parsed.spec, { dir: skillDir, meta: base.meta, usage: base.usage }));
    }
  }

  return finishReport(
    { target, skillDir, name: base.name, meta: base.meta, usage: base.usage, testSpec },
    diags,
  );
}

/** Layer used by `skillsmith test`: report cases + checks for one skill. */
export interface TestRunSummary {
  report: SkillReport;
  cases: number;
  /** Static checks executed: spec-shape + per-case cross-checks. */
  checks: number;
  failures: Diagnostic[];
}

/** Run the offline test-stub checks for a skill (see testspec.ts). */
export function runSkillTests(target: string): TestRunSummary {
  const report = validateSkill(target);
  if (report.skillDir === null || !existsSync(join(report.skillDir, "tests", "cases.yaml"))) {
    const missing = err("E_NO_TESTS", `no ${TESTSPEC_FILE}; scaffold one with \`skillsmith new\` or add it by hand`, {
      file: TESTSPEC_FILE,
    });
    return { report, cases: 0, checks: 0, failures: [missing] };
  }
  const specDiags = report.diagnostics.filter((d) => d.file === TESTSPEC_FILE || d.code.includes("CASE") || d.code.startsWith("E_TESTSPEC"));
  const cases = report.testSpec?.cases.length ?? 0;
  // Checks = shape checks (version, list) + 4 static checks per case.
  const checks = 2 + cases * 4;
  const failures = specDiags.filter((d) => d.severity === "error");
  return { report, cases, checks, failures };
}
