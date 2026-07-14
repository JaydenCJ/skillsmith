/**
 * Diagnostic model shared by every layer of the validator.
 *
 * A diagnostic is a stable machine-readable code (`E_*` errors fail
 * validation, `W_*` warnings fail only under `--strict`), a human message,
 * and an optional file/line anchor. Codes are part of the public API:
 * renaming one is a breaking change (see docs/schema.md for the full table).
 */

export type Severity = "error" | "warning";

export interface Diagnostic {
  /** Stable machine-readable code, e.g. `E_NAME_PATTERN`. */
  code: string;
  severity: Severity;
  /** One-line human explanation, always in English. */
  message: string;
  /** Path of the offending file, relative to the skill directory. */
  file?: string;
  /** 1-based line number inside `file`, when known. */
  line?: number;
}

/** Build an error diagnostic. */
export function err(
  code: string,
  message: string,
  at: { file?: string; line?: number } = {},
): Diagnostic {
  return { code, severity: "error", message, ...at };
}

/** Build a warning diagnostic. */
export function warn(
  code: string,
  message: string,
  at: { file?: string; line?: number } = {},
): Diagnostic {
  return { code, severity: "warning", message, ...at };
}

/** Errors first, then by file, line, and code — a stable order for output. */
export function sortDiagnostics(list: Diagnostic[]): Diagnostic[] {
  return [...list].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    const fa = a.file ?? "";
    const fb = b.file ?? "";
    if (fa !== fb) return fa < fb ? -1 : 1;
    const la = a.line ?? 0;
    const lb = b.line ?? 0;
    if (la !== lb) return la - lb;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
}

/** Count errors in a diagnostic list. */
export function errorCount(list: Diagnostic[]): number {
  return list.filter((d) => d.severity === "error").length;
}

/** Count warnings in a diagnostic list. */
export function warningCount(list: Diagnostic[]): number {
  return list.filter((d) => d.severity === "warning").length;
}

/** Render one diagnostic as `file:line CODE message` (parts optional). */
export function renderDiagnostic(d: Diagnostic): string {
  const anchor = d.file ? `${d.file}${d.line ? `:${d.line}` : ""} ` : "";
  return `${anchor}${d.code} ${d.message}`;
}

/**
 * Levenshtein edit distance, used to suggest the intended key when the
 * author typos a front-matter field (`argument_hint` → `argument-hint`).
 */
export function editDistance(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = prev[j] as number;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(cur + 1, (prev[j - 1] as number) + 1, diag + cost);
      diag = cur;
    }
  }
  return prev[b.length] as number;
}

/** Closest candidate within an edit distance of 2, or null. */
export function suggestKey(unknown: string, known: string[]): string | null {
  let best: string | null = null;
  let bestDist = 3;
  for (const candidate of known) {
    const d = editDistance(unknown.toLowerCase(), candidate);
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  return best;
}
