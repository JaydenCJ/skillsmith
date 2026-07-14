/**
 * Argument-placeholder analysis. A skill body can consume invocation
 * arguments as `$ARGUMENTS` (the whole string) or `$1`..`$9` (positional
 * words). The front-matter `argument-hint` advertises those arguments to
 * the user. This module finds every placeholder and cross-checks the two
 * sides: hints nobody consumes, placeholders nobody advertises, and
 * positional gaps are all bugs users hit at invocation time.
 */

import { Diagnostic, warn } from "./diagnostics.js";
import { SkillMeta } from "./schema.js";

export interface ArgUsage {
  /** Body uses `$ARGUMENTS`. */
  usesArguments: boolean;
  /** Sorted distinct positional indexes used, e.g. [1, 3]. */
  positions: number[];
  /** Highest positional index used, 0 when none. */
  maxPosition: number;
  /** First body line (1-based within the file) where each token appears. */
  firstLines: Record<string, number>;
}

const ARGUMENTS_TOKEN = /\$ARGUMENTS\b/;
const POSITIONAL_TOKEN = /\$([1-9])(?![0-9])/g;

/**
 * Scan a skill body for argument placeholders.
 *
 * @param body       Markdown body of SKILL.md.
 * @param lineOffset 1-based file line of the body's first line, so reported
 *                   lines point into the real file (default 1).
 */
export function analyzeArguments(body: string, lineOffset = 1): ArgUsage {
  const usage: ArgUsage = { usesArguments: false, positions: [], maxPosition: 0, firstLines: {} };
  const seen = new Set<number>();
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const fileLine = lineOffset + i;
    if (ARGUMENTS_TOKEN.test(line)) {
      usage.usesArguments = true;
      if (!("$ARGUMENTS" in usage.firstLines)) usage.firstLines["$ARGUMENTS"] = fileLine;
    }
    for (const match of line.matchAll(POSITIONAL_TOKEN)) {
      const n = Number.parseInt(match[1] as string, 10);
      seen.add(n);
      const token = `$${n}`;
      if (!(token in usage.firstLines)) usage.firstLines[token] = fileLine;
    }
  }
  usage.positions = [...seen].sort((a, b) => a - b);
  usage.maxPosition = usage.positions.length > 0 ? (usage.positions[usage.positions.length - 1] as number) : 0;
  return usage;
}

/** Number of argument slots an `argument-hint` advertises. */
export function hintArity(hint: string): number {
  const tokens = hint.match(/\[[^\]]*\]|<[^>]*>|\S+/g);
  return tokens === null ? 0 : tokens.length;
}

/** Cross-check placeholder usage against the front-matter hint. */
export function checkArguments(
  meta: Pick<SkillMeta, "argumentHint">,
  usage: ArgUsage,
  file = "SKILL.md",
  hintLine?: number,
): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const usesAny = usage.usesArguments || usage.positions.length > 0;

  // $3 without $2: the middle word is silently swallowed at invocation.
  for (let n = 1; n < usage.maxPosition; n++) {
    if (!usage.positions.includes(n)) {
      diags.push(
        warn("W_ARG_GAP", `body uses $${usage.maxPosition} but never $${n}; positional arguments are consumed in order`, {
          file,
          line: usage.firstLines[`$${usage.maxPosition}`],
        }),
      );
    }
  }

  if (usesAny && meta.argumentHint === undefined) {
    const first = usage.usesArguments ? "$ARGUMENTS" : `$${usage.positions[0] as number}`;
    diags.push(
      warn("W_NO_HINT", `body consumes arguments (${first}) but front-matter has no \`argument-hint\``, {
        file,
        line: usage.firstLines[first],
      }),
    );
  }

  if (!usesAny && meta.argumentHint !== undefined) {
    diags.push(
      warn("W_HINT_UNUSED", `\`argument-hint\` is "${meta.argumentHint}" but the body never uses $ARGUMENTS or $1..$9`, {
        file,
        line: hintLine,
      }),
    );
  }

  if (meta.argumentHint !== undefined && usage.maxPosition > 0) {
    const arity = hintArity(meta.argumentHint);
    if (usage.maxPosition > arity) {
      diags.push(
        warn(
          "W_HINT_ARITY",
          `body uses $${usage.maxPosition} but \`argument-hint\` ("${meta.argumentHint}") advertises only ${arity} argument(s)`,
          { file, line: hintLine },
        ),
      );
    }
  }

  return diags;
}
