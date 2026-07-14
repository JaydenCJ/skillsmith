/**
 * The skill front-matter schema: which keys exist, what shape each takes,
 * and the constraints that make a skill loadable across agent runtimes.
 * `validateFrontmatter` turns a parsed YAML value into a normalized
 * `SkillMeta` plus diagnostics; docs/schema.md is the human-readable twin
 * of the tables in this file.
 */

import { Diagnostic, err, suggestKey, warn } from "./diagnostics.js";

export const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const NAME_MAX_LENGTH = 64;
export const DESCRIPTION_MAX_LENGTH = 1024;
export const DESCRIPTION_MIN_LENGTH = 20;

/** Loose shape a tool entry must match, e.g. `Read` or `Bash(git log:*)`. */
const TOOL_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*(?:\([^()]*\))?$/;

/** Normalized, typed view of valid front-matter. */
export interface SkillMeta {
  name: string;
  description: string;
  license?: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  disableModelInvocation?: boolean;
  metadata?: Record<string, string>;
}

export interface SchemaResult {
  /** Normalized metadata; null when required fields are unusable. */
  meta: SkillMeta | null;
  diagnostics: Diagnostic[];
}

export const KNOWN_KEYS = [
  "name",
  "description",
  "license",
  "argument-hint",
  "allowed-tools",
  "model",
  "disable-model-invocation",
  "metadata",
] as const;

interface At {
  file: string;
  keyLines: Record<string, number>;
}

function lineOf(at: At, key: string): { file: string; line?: number } {
  const line = at.keyLines[key];
  return line === undefined ? { file: at.file } : { file: at.file, line };
}

function requireString(
  value: unknown,
  key: string,
  at: At,
  diags: Diagnostic[],
): string | null {
  if (typeof value === "string") {
    if (value.trim() === "") {
      diags.push(err("E_TYPE", `\`${key}\` must not be empty`, lineOf(at, key)));
      return null;
    }
    return value;
  }
  diags.push(err("E_TYPE", `\`${key}\` must be a string, got ${describeType(value)}`, lineOf(at, key)));
  return null;
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return typeof value === "object" ? "a mapping" : `a ${typeof value}`;
}

function checkName(name: string, at: At, diags: Diagnostic[]): void {
  if (name.length > NAME_MAX_LENGTH) {
    diags.push(
      err("E_NAME_LENGTH", `\`name\` is ${name.length} characters; the limit is ${NAME_MAX_LENGTH}`, lineOf(at, "name")),
    );
  }
  if (!NAME_PATTERN.test(name)) {
    diags.push(
      err(
        "E_NAME_PATTERN",
        `\`name\` must be lowercase letters, digits and single hyphens (got "${name}")`,
        lineOf(at, "name"),
      ),
    );
  }
}

function checkDescription(desc: string, at: At, diags: Diagnostic[]): void {
  const trimmed = desc.trim();
  if (trimmed.length > DESCRIPTION_MAX_LENGTH) {
    diags.push(
      err(
        "E_DESC_LENGTH",
        `\`description\` is ${trimmed.length} characters; the limit is ${DESCRIPTION_MAX_LENGTH}`,
        lineOf(at, "description"),
      ),
    );
  }
  if (trimmed.length < DESCRIPTION_MIN_LENGTH) {
    diags.push(
      warn(
        "W_DESC_SHORT",
        `\`description\` is only ${trimmed.length} characters; the model picks skills by this text`,
        lineOf(at, "description"),
      ),
    );
  }
  // The description doubles as the trigger: it should say WHEN to use the
  // skill, not only what it does. "when" (or "whenever") is the cheapest
  // reliable signal for that clause.
  if (!/\bwhen(ever)?\b/i.test(trimmed)) {
    diags.push(
      warn(
        "W_DESC_NO_TRIGGER",
        "`description` never says when to use the skill; add a \"Use when ...\" clause so it triggers",
        lineOf(at, "description"),
      ),
    );
  }
}

function normalizeTools(value: unknown, at: At, diags: Diagnostic[]): string[] | undefined {
  let entries: unknown[];
  if (typeof value === "string") {
    entries = value
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t !== "");
    if (entries.length === 0) {
      diags.push(err("E_TYPE", "`allowed-tools` must not be empty", lineOf(at, "allowed-tools")));
      return undefined;
    }
  } else if (Array.isArray(value)) {
    entries = value;
  } else {
    diags.push(
      err(
        "E_TYPE",
        `\`allowed-tools\` must be a comma-separated string or a list of strings, got ${describeType(value)}`,
        lineOf(at, "allowed-tools"),
      ),
    );
    return undefined;
  }
  const tools: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string" || entry.trim() === "") {
      diags.push(
        err("E_TYPE", `\`allowed-tools\` entries must be non-empty strings, got ${describeType(entry)}`, lineOf(at, "allowed-tools")),
      );
      continue;
    }
    const tool = entry.trim();
    if (!TOOL_PATTERN.test(tool)) {
      diags.push(
        warn("W_TOOL_PATTERN", `allowed-tools entry "${tool}" does not look like \`Tool\` or \`Tool(filter)\``, lineOf(at, "allowed-tools")),
      );
    }
    tools.push(tool);
  }
  return tools;
}

function normalizeMetadata(value: unknown, at: At, diags: Diagnostic[]): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    diags.push(err("E_TYPE", `\`metadata\` must be a mapping of scalars, got ${describeType(value)}`, lineOf(at, "metadata")));
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== null && typeof entry === "object") {
      diags.push(
        err("E_TYPE", `\`metadata.${key}\` must be a scalar, got ${describeType(entry)}`, lineOf(at, `metadata.${key}`)),
      );
      continue;
    }
    out[key] = entry === null ? "" : String(entry);
  }
  return out;
}

/**
 * Validate a parsed front-matter value against the schema.
 *
 * @param data     Value returned by the YAML parser.
 * @param keyLines Absolute SKILL.md line per key path (from `parseFrontmatter`).
 * @param file     Label used in diagnostics, default `SKILL.md`.
 */
export function validateFrontmatter(
  data: unknown,
  keyLines: Record<string, number> = {},
  file = "SKILL.md",
): SchemaResult {
  const diags: Diagnostic[] = [];
  const at: At = { file, keyLines };
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    diags.push(err("E_FRONTMATTER_TYPE", `front-matter must be a YAML mapping, got ${describeType(data)}`, { file, line: 2 }));
    return { meta: null, diagnostics: diags };
  }
  const map = data as Record<string, unknown>;

  for (const required of ["name", "description"] as const) {
    if (!(required in map)) {
      diags.push(err("E_MISSING_FIELD", `required field \`${required}\` is missing`, { file, line: 1 }));
    }
  }

  let name: string | null = null;
  if ("name" in map) {
    name = requireString(map["name"], "name", at, diags);
    if (name !== null) checkName(name, at, diags);
  }
  let description: string | null = null;
  if ("description" in map) {
    description = requireString(map["description"], "description", at, diags);
    if (description !== null) checkDescription(description, at, diags);
  }

  const meta: SkillMeta | null =
    name !== null && description !== null ? { name, description: description.trim() } : null;

  if ("license" in map) {
    const license = requireString(map["license"], "license", at, diags);
    if (license !== null && meta !== null) meta.license = license;
  }
  if ("argument-hint" in map) {
    const hint = requireString(map["argument-hint"], "argument-hint", at, diags);
    if (hint !== null && meta !== null) meta.argumentHint = hint;
  }
  if ("allowed-tools" in map) {
    const tools = normalizeTools(map["allowed-tools"], at, diags);
    if (tools !== undefined && meta !== null) meta.allowedTools = tools;
  }
  if ("model" in map) {
    const model = requireString(map["model"], "model", at, diags);
    if (model !== null && meta !== null) meta.model = model;
  }
  if ("disable-model-invocation" in map) {
    const value = map["disable-model-invocation"];
    if (typeof value !== "boolean") {
      diags.push(
        err("E_TYPE", `\`disable-model-invocation\` must be true or false, got ${describeType(value)}`, lineOf(at, "disable-model-invocation")),
      );
    } else if (meta !== null) meta.disableModelInvocation = value;
  }
  if ("metadata" in map) {
    const metadata = normalizeMetadata(map["metadata"], at, diags);
    if (metadata !== undefined && meta !== null) meta.metadata = metadata;
  }

  const known = new Set<string>(KNOWN_KEYS);
  for (const key of Object.keys(map)) {
    if (known.has(key) || key.startsWith("x-")) continue;
    const suggestion = suggestKey(key, [...KNOWN_KEYS]);
    const hint = suggestion !== null ? ` — did you mean \`${suggestion}\`?` : "";
    diags.push(warn("W_UNKNOWN_KEY", `unknown front-matter key \`${key}\`${hint}`, lineOf(at, key)));
  }

  return { meta, diagnostics: diags };
}
