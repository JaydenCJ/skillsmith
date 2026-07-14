# Examples

Two skills that bracket what skillsmith checks:

- **[changelog-draft/](changelog-draft/)** — a complete, healthy skill:
  trigger-shaped description, `argument-hint` wired to a `$1` placeholder,
  a `references/` file that exists and is linked, and an offline-checkable
  test stub in `tests/cases.yaml`. `skillsmith validate examples/changelog-draft`
  reports 0 errors and 0 warnings; `skillsmith test` passes all static checks.

- **[needs-work/](needs-work/)** — one small SKILL.md carrying nine distinct
  findings: an invalid and mismatched `name`, a typo'd key
  (`argument_hint`, with a did-you-mean suggestion), a description that is
  both too short and missing its "use when" trigger clause, a broken
  `references/` link, an unadvertised `$1`, a leftover TODO, and no test
  stub. Run `skillsmith validate examples/needs-work` to see the full report.

Try them from a checkout:

```bash
npm run build
node dist/cli.js list examples
node dist/cli.js validate examples          # walks the tree, finds both
node dist/cli.js test examples/changelog-draft
```
