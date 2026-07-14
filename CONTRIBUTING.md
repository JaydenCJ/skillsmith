# Contributing to skillsmith

Issues, discussions and pull requests are all welcome — this project aims
to stay small, zero-dependency at runtime, and strict about the checks.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner used by the suite).

```bash
git clone https://github.com/JaydenCJ/skillsmith.git
cd skillsmith
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 91 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check against examples/
```

`scripts/smoke.sh` scaffolds a skill, validates it plain and `--strict`,
runs the bundled healthy and broken examples, walks a tree, exercises
`info`/`test`/`--json`, and checks every exit code — it must print `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean (strict mode is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable modules
   (the YAML parser, schema, argument analysis and reference extraction all
   take strings, not files).
5. Any new or changed diagnostic needs a matching row in `docs/schema.md`
   and a test pinning the exact code, severity and anchor.

## Ground rules

- **No runtime dependencies.** The zero-dependency install is a core
  feature; adding one needs justification in the PR and will usually be
  declined.
- No network calls, ever — skillsmith reads and writes local files and
  nothing else.
- **Diagnostic codes are API.** `E_*`/`W_*` codes, their severities and the
  exit-code contract (0/1/2) are stable within a minor series; renaming a
  code is a breaking change.
- The scaffolder's contract is that its output validates with zero errors
  immediately — every template change must keep `tests/scaffold.test.mjs`
  green.
- The bundled examples are fixtures: `examples/changelog-draft` must stay
  spotless and `examples/needs-work` must keep exactly its advertised
  findings (both are pinned by tests).
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `skillsmith --version` output, the exact command line, the
`--json` report, and the SKILL.md (or a minimal front-matter snippet) that
reproduces it. For schema questions, cite the relevant table in
`docs/schema.md`.

## Security

Do not open public issues for security problems (especially anything that
lets a crafted SKILL.md or cases.yaml read or write outside the skill
directory); use GitHub private vulnerability reporting on this repository
instead.
