// Argument-placeholder analysis and the hint/body cross-checks. These
// mismatches are the bugs users only hit at invocation time — a hint that
// promises arguments nobody reads, positional gaps that swallow a word.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { analyzeArguments, checkArguments, hintArity } from "../dist/args.js";

test("finds $ARGUMENTS and positional placeholders with first-use lines", () => {
  const usage = analyzeArguments("line one\nuse $ARGUMENTS here\nand $2 then $1\nagain $2", 10);
  assert.equal(usage.usesArguments, true);
  assert.deepEqual(usage.positions, [1, 2]);
  assert.equal(usage.maxPosition, 2);
  assert.equal(usage.firstLines["$ARGUMENTS"], 11);
  assert.equal(usage.firstLines["$2"], 12, "first use wins, later repeats do not overwrite");
});

test("near-misses do not match: $10 is not $1, $ARGUMENTSX is not $ARGUMENTS", () => {
  // "$10" = "$1" would misread money amounts; the regex requires no trailing digit.
  const usage = analyzeArguments("pay $10 to $ARGUMENTSX");
  assert.deepEqual(usage.positions, []);
  assert.equal(usage.usesArguments, false);
  assert.deepEqual(analyzeArguments("plain instructions only"), {
    usesArguments: false,
    positions: [],
    maxPosition: 0,
    firstLines: {},
  });
});

test("hintArity counts bracketed, angled and bare tokens", () => {
  assert.equal(hintArity("[from] [to]"), 2);
  assert.equal(hintArity("<file>"), 1);
  assert.equal(hintArity("[revision range or empty]"), 1, "one bracket group is one slot");
  assert.equal(hintArity(""), 0);
});

test("W_ARG_GAP fires once per missing intermediate position", () => {
  const usage = analyzeArguments("use $1 and $4");
  const diags = checkArguments({}, usage);
  const gaps = diags.filter((d) => d.code === "W_ARG_GAP");
  assert.equal(gaps.length, 2);
  assert.match(gaps[0].message, /\$4 but never \$2/);
  assert.match(gaps[1].message, /\$4 but never \$3/);
});

test("W_NO_HINT when the body consumes arguments the front-matter never advertises", () => {
  const usage = analyzeArguments("takes $ARGUMENTS");
  const diags = checkArguments({}, usage);
  assert.deepEqual(diags.map((d) => d.code), ["W_NO_HINT"]);
});

test("W_HINT_UNUSED when the hint advertises arguments the body never reads", () => {
  const usage = analyzeArguments("no placeholders here");
  const diags = checkArguments({ argumentHint: "[file]" }, usage, "SKILL.md", 4);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].code, "W_HINT_UNUSED");
  assert.equal(diags[0].line, 4, "anchored to the argument-hint line");
});

test("W_HINT_ARITY when the body reads past the advertised slot count", () => {
  const usage = analyzeArguments("uses $1 and $2");
  const diags = checkArguments({ argumentHint: "[range]" }, usage);
  assert.deepEqual(diags.map((d) => d.code), ["W_HINT_ARITY"]);
  assert.match(diags[0].message, /\$2 .* only 1 argument/);
});

test("consistent hint + body pairs are silent; $ARGUMENTS alone never triggers arity", () => {
  const positional = analyzeArguments("uses $1 then $2");
  assert.deepEqual(checkArguments({ argumentHint: "[from] [to]" }, positional), []);
  const whole = analyzeArguments("takes $ARGUMENTS whole");
  assert.deepEqual(checkArguments({ argumentHint: "[anything at all]" }, whole), []);
});
