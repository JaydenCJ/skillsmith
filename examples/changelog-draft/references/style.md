# Changelog style

## Commit-type mapping

| Commit subject starts with | Changelog category |
|---|---|
| `feat`, `add` | Added |
| `refactor`, `perf`, `change` | Changed |
| `fix`, `bug` | Fixed |
| `remove`, `drop`, `deprecate` | Removed |
| `docs`, `chore`, `ci`, `release` | (omit) |

## Formatting rules

- One `## [Unreleased]` heading, then `### Added` / `### Changed` /
  `### Fixed` / `### Removed` in that order; skip empty categories.
- Bullets are complete sentences in the past tense, user-facing, and never
  reference file paths, PR numbers, or author names.
- Group several commits that land one feature into a single bullet.
