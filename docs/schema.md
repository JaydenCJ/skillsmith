# The skill schema skillsmith checks

A skill is a directory shipping a `SKILL.md`: YAML front-matter between
`---` fences, then a markdown body of instructions. Supporting material
lives in conventional subdirectories (`references/`, `scripts/`, `assets/`,
`templates/`) and the skillsmith test stub in `tests/cases.yaml`. This page
is the human-readable twin of `src/schema.ts` — if they disagree, that is
a bug.

## Front-matter fields

| Key | Type | Required | Constraint |
|---|---|---|---|
| `name` | string | yes | `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 64 chars, must equal the directory name |
| `description` | string | yes | ≤ 1024 chars; should include a "use when …" trigger clause |
| `license` | string | no | SPDX identifier recommended |
| `argument-hint` | string | no | shown at invocation, e.g. `"[from] [to]"`; arity is cross-checked against `$1..$9` |
| `allowed-tools` | string or list | no | comma-separated string or YAML list; entries look like `Tool` or `Tool(filter)` |
| `model` | string | no | model override for this skill |
| `disable-model-invocation` | boolean | no | `true` keeps the skill manual-only |
| `metadata` | mapping | no | scalar values only; free-form |
| `x-*` | any | no | extension escape hatch, never warned about |

The YAML subset accepted is deliberately boring: block mappings and
sequences, flow sequences, plain/quoted scalars, `|` and `>` block scalars,
comments. Anchors, aliases, tags, and flow mappings are rejected with a
lined error — some agent runtime would have choked on them anyway.

## Diagnostics

Errors (`E_*`) fail `validate`; warnings (`W_*`) fail only with `--strict`.

| Code | Severity | Fires when |
|---|---|---|
| `E_NO_FRONTMATTER` | error | file does not start with `---` on line 1 |
| `E_UNCLOSED_FRONTMATTER` | error | opening fence never closed |
| `E_YAML` | error | front-matter is not parseable YAML (subset above) |
| `E_FRONTMATTER_TYPE` | error | front-matter is not a mapping |
| `E_MISSING_FIELD` | error | `name` or `description` absent |
| `E_TYPE` | error | a field has the wrong type or is empty |
| `E_NAME_PATTERN` / `E_NAME_LENGTH` | error | `name` violates the pattern / length limit |
| `E_NAME_MISMATCH` | error | `name` differs from the skill directory name |
| `E_DESC_LENGTH` | error | `description` over 1024 characters |
| `E_EMPTY_BODY` | error | no instructions after the front-matter |
| `E_BROKEN_REF` | error | body links a relative path that does not exist (or escapes the directory) |
| `W_UNKNOWN_KEY` | warning | unrecognized front-matter key (with a did-you-mean suggestion) |
| `W_DESC_SHORT` | warning | `description` under 20 characters |
| `W_DESC_NO_TRIGGER` | warning | `description` never says *when* to use the skill |
| `W_TOOL_PATTERN` | warning | an `allowed-tools` entry looks malformed |
| `W_NO_HINT` | warning | body consumes `$ARGUMENTS`/`$N` but no `argument-hint` advertises them |
| `W_HINT_UNUSED` | warning | `argument-hint` present but body never reads arguments |
| `W_HINT_ARITY` | warning | body reads `$N` beyond what the hint advertises |
| `W_ARG_GAP` | warning | body uses `$3` but never `$2` — a word is silently swallowed |
| `W_PLACEHOLDER` | warning | leftover TODO/FIXME/TBD in description or body |
| `W_BODY_LONG` | warning | body over 500 lines; move detail into `references/` |
| `W_UNREFERENCED_FILE` | warning | bundled file the body never mentions (dead weight) |
| `W_SCRIPT_NO_SHEBANG` | warning | a `scripts/` file without `#!` on line 1 |
| `W_NESTED_SKILL` | warning | a `SKILL.md` nested inside another skill (invisible to runtimes) |
| `W_NO_TESTS` | warning | no `tests/cases.yaml` stub |

## The test stub (`tests/cases.yaml`)

```yaml
skillsmith-tests: 1
cases:
  - name: explicit-range          # lowercase slug, unique per file
    prompt: Draft a changelog entry for everything between v1.2.0 and v1.3.0
    args: "v1.2.0..v1.3.0"        # the invocation arguments; "" tests the no-arg path
    expect:
      files: [references/style.md]        # must ship with the skill
      output-contains: ["## [Unreleased]"]
```

`skillsmith test` cannot run your model, and does not pretend to. It runs
the checks that ARE decidable offline: the spec parses and is version 1,
case names are unique slugs, prompts are non-empty (TODO prompts warn),
every `expect.files` entry ships with the skill and stays inside it, and
each case's `args` supplies enough words for the highest `$N` the body
reads. `E_*` findings fail the run; the summary line counts cases and
static checks. Wire the same file into your eval harness for the
model-in-the-loop half.

| Code | Severity | Fires when |
|---|---|---|
| `E_TESTSPEC` / `E_TESTSPEC_VERSION` | error | file shape or version marker wrong |
| `E_CASE_FIELD` / `E_CASE_TYPE` | error | a case is missing `name`/`prompt` or mistypes a field |
| `E_DUPLICATE_CASE` | error | two cases share a name |
| `E_CASE_FILE` | error | `expect.files` names a file the skill does not ship |
| `E_NO_TESTS` | error | `skillsmith test` on a skill with no stub |
| `W_CASE_TODO` | warning | placeholder prompt left in a case |
| `W_CASE_ARITY` | warning | non-empty `args` with fewer words than the body's highest `$N` |
| `W_CASE_NO_ARGS` | warning | skill consumes arguments but the case omits `args` |
| `W_CASE_UNKNOWN_KEY` | warning | unrecognized key in a case |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success (validate: no errors; with `--strict`, no warnings either) |
| 1 | findings — validation errors, strict warnings, or failing test checks |
| 2 | usage or I/O trouble — unknown command/flag, unreadable path |
