#!/usr/bin/env bash
# Smoke test for skillsmith: exercises the real CLI end to end — scaffold a
# skill, validate it (plain and --strict), validate the bundled healthy and
# broken examples, walk a tree, print info, run the offline test-stub
# checks, and verify JSON output and exit codes. No network, idempotent,
# runs from a clean checkout (after `npm install`). Prints "SMOKE OK".
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents every subcommand.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in new validate list info test; do
  echo "$HELP" | grep -q "$word" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 2b. The CLI must still run when invoked through a symlink — exactly how
#     `npm install -g` wires the `skillsmith` bin to dist/cli.js.
ln -s "$ROOT/dist/cli.js" "$WORKDIR/skillsmith-bin"
LINKED="$(node "$WORKDIR/skillsmith-bin" --version)"
[ "$LINKED" = "$PKG_VERSION" ] || fail "symlinked entry point printed \"$LINKED\" (bin-shim regression)"
echo "[smoke] symlinked bin ok"

# 3. Exit codes: unknown commands/flags and unreadable paths exit 2.
set +e
$CLI frobnicate >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown command should exit 2"; }
$CLI validate --bogus-flag >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown flag should exit 2"; }
$CLI validate "$WORKDIR/nope" >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "missing path should exit 2"; }
$CLI new UPPER_CASE >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "bad name should exit 2"; }
set -e
echo "[smoke] exit codes ok (2 usage/io)"

# 4. Scaffold a skill; it must validate with zero errors out of the box.
(cd "$WORKDIR" && $CLI new release-notes --hint "[range]" --tools "Bash(git log:*),Read") \
  | grep -q "created release-notes" || fail "new did not report creation"
[ -f "$WORKDIR/release-notes/SKILL.md" ] || fail "scaffold missing SKILL.md"
[ -f "$WORKDIR/release-notes/tests/cases.yaml" ] || fail "scaffold missing test stub"
$CLI validate "$WORKDIR/release-notes" | grep -q "OK — 0 error(s)" || fail "fresh scaffold should validate"
echo "[smoke] new ok (scaffold validates clean)"

# 5. --strict refuses the leftover TODOs; new without --force refuses to clobber.
set +e
$CLI validate "$WORKDIR/release-notes" --strict >/dev/null; [ $? -eq 1 ] || { set -e; fail "--strict should fail on scaffold TODOs"; }
(cd "$WORKDIR" && $CLI new release-notes >/dev/null 2>&1); [ $? -eq 2 ] || { set -e; fail "new over existing dir should exit 2"; }
set -e
(cd "$WORKDIR" && $CLI new release-notes --force >/dev/null) || fail "new --force should succeed"
echo "[smoke] strict + clobber guard ok"

# 6. The bundled healthy example is spotless.
OUT="$($CLI validate "$ROOT/examples/changelog-draft")"
echo "$OUT" | grep -q "changelog-draft: OK — 0 error(s), 0 warning(s)" || fail "healthy example not clean: $OUT"
echo "[smoke] healthy example ok"

# 7. The bundled broken example carries the advertised findings, exit 1.
set +e
BAD="$($CLI validate "$ROOT/examples/needs-work")"; BAD_CODE=$?
set -e
[ "$BAD_CODE" -eq 1 ] || fail "broken example should exit 1, got $BAD_CODE"
for code in E_NAME_PATTERN E_NAME_MISMATCH E_BROKEN_REF W_UNKNOWN_KEY W_DESC_NO_TRIGGER W_NO_HINT W_PLACEHOLDER; do
  echo "$BAD" | grep -q "$code" || fail "broken example missing $code"
done
echo "$BAD" | grep -q 'did you mean `argument-hint`' || fail "typo suggestion missing"
echo "[smoke] broken example ok (all findings present)"

# 8. Tree walking: validate + list discover both examples.
set +e
TREE="$($CLI validate "$ROOT/examples")"
set -e
echo "$TREE" | grep -q "2 skill(s) checked, 1 with findings" || fail "tree validate summary wrong: $TREE"
$CLI list "$ROOT/examples" | grep -q "found 2 skill(s)" || fail "list should find 2 skills"
echo "[smoke] tree discovery ok"

# 9. info surfaces the parsed metadata.
INFO="$($CLI info "$ROOT/examples/changelog-draft")"
echo "$INFO" | grep -q "argument-hint:  \[revision-range\]" || fail "info missing hint"
echo "$INFO" | grep -q "test cases:     2" || fail "info missing case count"
echo "[smoke] info ok"

# 10. Offline test-stub checks pass for the healthy example, and catch a
#     stub that expects a file the skill does not ship.
$CLI test "$ROOT/examples/changelog-draft" | grep -q "OK — every case is well-formed" || fail "test should pass"
cp -R "$ROOT/examples/changelog-draft" "$WORKDIR/changelog-draft"
node -e '
  const fs = require("node:fs");
  const p = process.argv[1];
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("references/style.md", "references/missing.md"));
' "$WORKDIR/changelog-draft/tests/cases.yaml"
set +e
TAMPER="$($CLI test "$WORKDIR/changelog-draft")"; TAMPER_CODE=$?
set -e
[ "$TAMPER_CODE" -eq 1 ] || fail "tampered stub should exit 1, got $TAMPER_CODE"
echo "$TAMPER" | grep -q "E_CASE_FILE" || fail "tampered stub not reported as E_CASE_FILE"
echo "[smoke] test-stub checks ok (missing expected file caught)"

# 11. JSON output is real JSON with the right shape.
$CLI validate "$ROOT/examples/changelog-draft" --json | node -e '
  let data = "";
  process.stdin.on("data", (c) => (data += c));
  process.stdin.on("end", () => {
    const doc = JSON.parse(data);
    const s = doc.skills[0];
    if (s.name !== "changelog-draft" || s.ok !== true || s.errors !== 0) process.exit(1);
  });
' || fail "validate --json shape wrong"
echo "[smoke] json ok"

echo "SMOKE OK"
