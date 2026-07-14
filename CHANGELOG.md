# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- **`skillsmith new`**: scaffolds a skill directory (SKILL.md with
  trigger-shaped description, `references/`, `tests/cases.yaml` stub) that
  validates with zero errors immediately; `--hint` wires `argument-hint`
  to a real `$ARGUMENTS` placeholder, plus `--tools`, `--model`,
  `--license`, `--no-tests`, `--force`, and refusal to clobber non-empty
  directories.
- A dependency-free **YAML subset parser** for front-matter (block
  mappings/sequences, flow sequences, quoted scalars, `|`/`>` block
  scalars, comments) that rejects anchors, aliases, tags, flow mappings
  and tab indentation with lined errors instead of misparsing, and tracks
  the source line of every key.
- **Front-matter schema validation** with stable `E_*`/`W_*` codes and
  file:line anchors: required `name`/`description`, name pattern and
  64-char limit, 1024-char description limit with trigger-clause and
  length heuristics, `allowed-tools` normalization (string or list),
  typed `metadata`, `x-` extension keys, and edit-distance
  did-you-mean suggestions for unknown keys.
- **Argument cross-checks** between the body's `$ARGUMENTS`/`$1..$9`
  placeholders and `argument-hint`: unadvertised placeholders, unused
  hints, positional gaps, and hint-arity mismatches.
- **Structure and reference sweeps**: broken or escaping relative
  references (markdown links and path-shaped code spans), bundled files
  the body never mentions, shebang-less scripts, nested SKILL.md files,
  name/directory disagreement, body-length and leftover-TODO hygiene.
- The **`skillsmith-tests: 1` test-stub format** and its offline checks:
  spec shape and version, unique slug case names, placeholder prompts,
  expectation files that must ship with the skill, argument arity per
  case; run via `skillsmith test` with a cases/checks summary.
- `skillsmith validate` (single skill, SKILL.md path, or whole trees via
  discovery) with `--strict`, `--quiet` and `--json`; `list` and `info`;
  GNU-style exit codes 0/1/2 across every command.
- Public typed API (`validateSkill`, `validateSkillSource`,
  `scaffoldSkill`, `parseFrontmatter`, `parseYaml`, `parseTestSpec`,
  `discoverSkills`, `extractReferences`, ...) with declarations.
- Bundled example skills (`examples/changelog-draft` spotless,
  `examples/needs-work` with nine pinned findings), the field-by-field
  schema reference in `docs/schema.md`, 91 node:test tests, and an
  end-to-end `scripts/smoke.sh`.

[0.1.0]: https://github.com/JaydenCJ/skillsmith/releases/tag/v0.1.0
