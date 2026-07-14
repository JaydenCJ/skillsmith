/**
 * SKILL.md = YAML front-matter between `---` fences + a markdown body.
 * This module splits the two and reports fence-level problems; the YAML
 * inside is handed to the subset parser, and every line number is mapped
 * back to the position in the original file.
 */

import { Diagnostic, err } from "./diagnostics.js";
import { parseYaml } from "./yaml.js";

export interface FrontmatterResult {
  /** Parsed front-matter value (normally a mapping), or null on failure. */
  data: unknown;
  /** 1-based SKILL.md line of each front-matter key, by dotted path. */
  keyLines: Record<string, number>;
  /** Markdown body after the closing fence (leading newlines kept). */
  body: string;
  /** 1-based line in SKILL.md where the body starts (0 = no body). */
  bodyLine: number;
  diagnostics: Diagnostic[];
}

const OPEN_FENCE = /^---\s*$/;
const CLOSE_FENCE = /^(?:---|\.\.\.)\s*$/;

/** Split and parse a SKILL.md source string. `file` labels diagnostics. */
export function parseFrontmatter(source: string, file = "SKILL.md"): FrontmatterResult {
  const empty: FrontmatterResult = { data: null, keyLines: {}, body: "", bodyLine: 0, diagnostics: [] };
  // Tolerate a UTF-8 BOM, but nothing else before the opening fence.
  const text = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || !OPEN_FENCE.test(lines[0] as string)) {
    empty.diagnostics.push(
      err("E_NO_FRONTMATTER", "file must start with a `---` front-matter fence on line 1", { file, line: 1 }),
    );
    empty.body = text;
    empty.bodyLine = 1;
    return empty;
  }
  let closeAt = -1;
  for (let i = 1; i < lines.length; i++) {
    if (CLOSE_FENCE.test(lines[i] as string)) {
      closeAt = i;
      break;
    }
  }
  if (closeAt === -1) {
    empty.diagnostics.push(
      err("E_UNCLOSED_FRONTMATTER", "front-matter fence `---` is never closed", { file, line: 1 }),
    );
    return empty;
  }
  const fmSource = lines.slice(1, closeAt).join("\n");
  const parsed = parseYaml(fmSource);
  const diagnostics: Diagnostic[] = parsed.errors.map((e) =>
    err("E_YAML", e.message, { file, line: e.line + 1 }),
  );
  const keyLines: Record<string, number> = {};
  for (const [path, line] of Object.entries(parsed.keyLines)) keyLines[path] = line + 1;
  const body = lines.slice(closeAt + 1).join("\n");
  return {
    data: parsed.value,
    keyLines,
    body,
    bodyLine: closeAt + 2,
    diagnostics,
  };
}
