---
name: changelog-draft
description: >-
  Drafts a Keep-a-Changelog entry from a git revision range. Use when the
  user asks to write, update, or backfill a changelog from recent commits.
argument-hint: "[revision-range]"
allowed-tools: Bash(git log:*), Read, Edit
license: MIT
metadata:
  audience: maintainers
---

# changelog-draft

Draft one changelog entry for the revision range given as $1. When no range
is passed, use everything since the most recent tag.

## Steps

1. Collect the commits: run `git log --no-merges --pretty=format:'%h %s' $1`
   (fall back to `$(git describe --tags --abbrev=0)..HEAD` when $1 is empty).
2. Classify each commit into Added / Changed / Fixed / Removed using the
   mapping table in [references/style.md](references/style.md). Drop release
   chores (version bumps, lockfile-only changes).
3. Rewrite each subject line as a user-facing sentence: what changed and why
   it matters, not which file moved. Merge commits that describe one change.
4. Emit a single `## [Unreleased]` section with only the non-empty
   categories, following the formatting rules in
   [references/style.md](references/style.md).

## Output

A fenced markdown block containing the drafted section, ready to paste into
CHANGELOG.md — no preamble, no commentary after it. Every bullet is one
sentence, starts with a verb, and never mentions internal file paths.
