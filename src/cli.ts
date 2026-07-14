#!/usr/bin/env node
/**
 * The skillsmith CLI. Exit codes are GNU-flavored and stable:
 *   0 — success (validate: no errors; with --strict, no warnings either)
 *   1 — findings (validation errors, strict warnings, failing test checks)
 *   2 — usage or I/O trouble (unknown command/flag, unreadable path)
 */

import { realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { discoverSkills } from "./discover.js";
import { Diagnostic, renderDiagnostic } from "./diagnostics.js";
import { ScaffoldError, scaffoldSkill, ScaffoldOptions } from "./scaffold.js";
import { runSkillTests, SkillReport, validateSkill } from "./validate.js";
import { VERSION } from "./version.js";

const USAGE = `skillsmith ${VERSION} — scaffold and validate agent skills

Usage:
  skillsmith new <name> [--dir <parent>] [--description <text>] [--hint <text>]
                        [--tools <a,b>] [--model <id>] [--license <spdx>]
                        [--no-tests] [--force]
  skillsmith validate <path>... [--strict] [--json] [--quiet]
  skillsmith list [<dir>] [--json]
  skillsmith info <path> [--json]
  skillsmith test <path> [--json]
  skillsmith --help | --version

Commands:
  new        scaffold a skill directory (SKILL.md, references/, test stub)
  validate   check front-matter schema, structure, arguments and test stubs;
             a <path> may be a SKILL.md, a skill directory, or a tree of them
  list       discover every skill under a directory (default: .)
  info       print a skill's parsed metadata and usage summary
  test       run the offline checks for tests/cases.yaml

Exit codes: 0 ok · 1 findings · 2 usage or I/O error`;

interface Io {
  out: (line: string) => void;
  errOut: (line: string) => void;
}

interface Parsed {
  positional: string[];
  flags: Map<string, string | true>;
}

const VALUE_FLAGS = new Set(["dir", "description", "hint", "tools", "model", "license"]);
const BOOL_FLAGS = new Set(["no-tests", "force", "strict", "json", "quiet", "help", "version"]);

function parseArgs(argv: string[]): Parsed | string {
  const parsed: Parsed = { positional: [], flags: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith("--")) {
      parsed.positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (BOOL_FLAGS.has(name)) {
      if (eq !== -1) return `flag --${name} takes no value`;
      parsed.flags.set(name, true);
    } else if (VALUE_FLAGS.has(name)) {
      const value = eq !== -1 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined) return `flag --${name} needs a value`;
      parsed.flags.set(name, value);
    } else {
      return `unknown flag --${name}`;
    }
  }
  return parsed;
}

function reportToJson(report: SkillReport): Record<string, unknown> {
  return {
    target: report.target,
    name: report.name,
    ok: report.ok,
    errors: report.errors,
    warnings: report.warnings,
    diagnostics: report.diagnostics,
  };
}

function printReport(report: SkillReport, io: Io, quiet: boolean): void {
  const label = report.name ?? report.target;
  const verdict = report.ok ? "OK" : "INVALID";
  io.out(`${label}: ${verdict} — ${report.errors} error(s), ${report.warnings} warning(s)`);
  if (quiet) return;
  for (const d of report.diagnostics) io.out(`  ${renderDiagnostic(d)}`);
}

/** Expand a CLI path into one or many skill targets. */
function expandTargets(path: string): string[] {
  const skills = discoverSkills(path);
  if (skills.length > 0) return skills;
  return [path]; // a file, or a bad path — validateSkill reports it
}

function cmdValidate(parsed: Parsed, io: Io): number {
  if (parsed.positional.length === 0) {
    io.errOut("validate: needs at least one <path>");
    return 2;
  }
  const strict = parsed.flags.has("strict");
  const quiet = parsed.flags.has("quiet");
  const reports: SkillReport[] = [];
  for (const target of parsed.positional) {
    for (const expanded of expandTargets(target)) {
      try {
        const report = validateSkill(expanded);
        report.target = humanPath(expanded);
        reports.push(report);
      } catch (error) {
        io.errOut(`validate: ${(error as Error).message}`);
        return 2;
      }
    }
  }
  if (parsed.flags.has("json")) {
    io.out(JSON.stringify({ skills: reports.map(reportToJson) }, null, 2));
  } else {
    for (const report of reports) printReport(report, io, quiet);
    const bad = reports.filter((r) => r.errors > 0 || r.warnings > 0).length;
    io.out(`${reports.length} skill(s) checked, ${bad} with findings`);
  }
  const failed = reports.some((r) => !r.ok || (strict && r.warnings > 0));
  return failed ? 1 : 0;
}

function humanPath(path: string): string {
  const rel = relative(process.cwd(), resolve(path));
  return rel === "" ? "." : rel.startsWith("..") ? resolve(path) : rel;
}

function cmdNew(parsed: Parsed, io: Io): number {
  const name = parsed.positional[0];
  if (name === undefined) {
    io.errOut("new: needs a skill <name>");
    return 2;
  }
  if (parsed.positional.length > 1) {
    io.errOut(`new: unexpected argument "${parsed.positional[1]}"`);
    return 2;
  }
  const options: ScaffoldOptions = { name };
  const dir = parsed.flags.get("dir");
  if (typeof dir === "string") options.dir = dir;
  const description = parsed.flags.get("description");
  if (typeof description === "string") options.description = description;
  const hint = parsed.flags.get("hint");
  if (typeof hint === "string") options.hint = hint;
  const tools = parsed.flags.get("tools");
  if (typeof tools === "string") {
    options.tools = tools.split(",").map((t) => t.trim()).filter((t) => t !== "");
  }
  const model = parsed.flags.get("model");
  if (typeof model === "string") options.model = model;
  const license = parsed.flags.get("license");
  if (typeof license === "string") options.license = license;
  if (parsed.flags.has("no-tests")) options.noTests = true;
  if (parsed.flags.has("force")) options.force = true;
  try {
    const result = scaffoldSkill(options);
    io.out(`created ${humanPath(result.dir)} (${result.files.join(", ")})`);
    io.out(`next: edit the TODOs, then run \`skillsmith validate ${humanPath(result.dir)} --strict\``);
    return 0;
  } catch (error) {
    if (error instanceof ScaffoldError) {
      io.errOut(`new: ${error.message}`);
      return 2;
    }
    throw error;
  }
}

function cmdList(parsed: Parsed, io: Io): number {
  const root = parsed.positional[0] ?? ".";
  if (parsed.positional.length > 1) {
    io.errOut(`list: unexpected argument "${parsed.positional[1]}"`);
    return 2;
  }
  const dirs = discoverSkills(root);
  const entries = dirs.map((dir) => {
    try {
      const report = validateSkill(dir);
      return {
        path: humanPath(dir),
        name: report.name,
        ok: report.ok,
        description: report.meta?.description ?? null,
      };
    } catch {
      return { path: humanPath(dir), name: null, ok: false, description: null };
    }
  });
  if (parsed.flags.has("json")) {
    io.out(JSON.stringify({ skills: entries }, null, 2));
    return 0;
  }
  io.out(`found ${entries.length} skill(s) under ${humanPath(root)}`);
  for (const entry of entries) {
    const name = entry.name ?? "(unnamed)";
    const mark = entry.ok ? "ok     " : "invalid";
    const desc = entry.description === null ? "" : ` — ${truncate(entry.description, 60)}`;
    io.out(`  ${mark} ${name}  ${entry.path}${desc}`);
  }
  return 0;
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function cmdInfo(parsed: Parsed, io: Io): number {
  const target = parsed.positional[0];
  if (target === undefined) {
    io.errOut("info: needs a skill <path>");
    return 2;
  }
  let report: SkillReport;
  try {
    report = validateSkill(target);
  } catch (error) {
    io.errOut(`info: ${(error as Error).message}`);
    return 2;
  }
  if (parsed.flags.has("json")) {
    io.out(
      JSON.stringify(
        { ...reportToJson(report), meta: report.meta, usage: report.usage, cases: report.testSpec?.cases.length ?? 0 },
        null,
        2,
      ),
    );
    return report.ok ? 0 : 1;
  }
  io.out(`name:           ${report.name ?? "(unparseable)"}`);
  if (report.meta !== null) {
    io.out(`description:    ${truncate(report.meta.description, 70)}`);
    if (report.meta.argumentHint !== undefined) io.out(`argument-hint:  ${report.meta.argumentHint}`);
    if (report.meta.allowedTools !== undefined) io.out(`allowed-tools:  ${report.meta.allowedTools.join(", ")}`);
    if (report.meta.model !== undefined) io.out(`model:          ${report.meta.model}`);
    if (report.meta.license !== undefined) io.out(`license:        ${report.meta.license}`);
  }
  const argsUsed = [
    ...(report.usage.usesArguments ? ["$ARGUMENTS"] : []),
    ...report.usage.positions.map((n) => `$${n}`),
  ];
  io.out(`arguments:      ${argsUsed.length > 0 ? argsUsed.join(", ") : "none"}`);
  io.out(`test cases:     ${report.testSpec?.cases.length ?? 0}`);
  io.out(`validation:     ${report.ok ? "OK" : "INVALID"} — ${report.errors} error(s), ${report.warnings} warning(s)`);
  return report.ok ? 0 : 1;
}

function cmdTest(parsed: Parsed, io: Io): number {
  const target = parsed.positional[0];
  if (target === undefined) {
    io.errOut("test: needs a skill <path>");
    return 2;
  }
  let summary: ReturnType<typeof runSkillTests>;
  try {
    summary = runSkillTests(target);
  } catch (error) {
    io.errOut(`test: ${(error as Error).message}`);
    return 2;
  }
  const failed = summary.failures.length > 0 || !summary.report.ok;
  if (parsed.flags.has("json")) {
    io.out(
      JSON.stringify(
        {
          target: summary.report.target,
          cases: summary.cases,
          checks: summary.checks,
          ok: !failed,
          failures: summary.failures,
        },
        null,
        2,
      ),
    );
    return failed ? 1 : 0;
  }
  const label = summary.report.name ?? target;
  io.out(`${label}: ${summary.cases} case(s), ${summary.checks} static check(s)`);
  const shown = new Set<Diagnostic>();
  for (const d of summary.failures) {
    io.out(`  ${renderDiagnostic(d)}`);
    shown.add(d);
  }
  if (!summary.report.ok) {
    for (const d of summary.report.diagnostics) {
      if (d.severity === "error" && !shown.has(d)) io.out(`  ${renderDiagnostic(d)}`);
    }
  }
  io.out(failed ? "FAIL — fix the findings above" : "OK — every case is well-formed and consistent with the skill");
  return failed ? 1 : 0;
}

/** Entry point, factored for tests. Returns the process exit code. */
export function runCli(argv: string[], io: Io = { out: console.log, errOut: console.error }): number {
  const parsed = parseArgs(argv);
  if (typeof parsed === "string") {
    io.errOut(`skillsmith: ${parsed}`);
    return 2;
  }
  if (parsed.flags.has("version")) {
    io.out(VERSION);
    return 0;
  }
  const command = parsed.positional.shift();
  if (parsed.flags.has("help") || command === undefined || command === "help") {
    io.out(USAGE);
    return command === undefined && !parsed.flags.has("help") ? 2 : 0;
  }
  switch (command) {
    case "new":
      return cmdNew(parsed, io);
    case "validate":
      return cmdValidate(parsed, io);
    case "list":
      return cmdList(parsed, io);
    case "info":
      return cmdInfo(parsed, io);
    case "test":
      return cmdTest(parsed, io);
    default:
      io.errOut(`skillsmith: unknown command "${command}" (see --help)`);
      return 2;
  }
}

// Run only when this file is the entry point. argv[1] is realpath'd first:
// `npm install -g` invokes the CLI through a bin symlink, while Node resolves
// import.meta.url to the real file — a plain comparison would never match.
const invokedDirectly = ((): boolean => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  process.exitCode = runCli(process.argv.slice(2));
}
