/**
 * Skill discovery: walk a directory tree and return every directory that
 * contains a SKILL.md. Skills do not nest, so discovery does not descend
 * into a found skill; dependency and VCS directories are skipped.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage", "target", "__pycache__"]);

/**
 * Find skill directories under `root` (inclusive), sorted by path.
 * Returns absolute paths.
 */
export function discoverSkills(root: string): string[] {
  const start = resolve(root);
  const found: string[] = [];
  const walk = (dir: string): void => {
    if (existsSync(join(dir, "SKILL.md"))) {
      found.push(dir);
      return; // skills do not nest
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries.sort()) {
      if (entry.startsWith(".") || SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      let isDir: boolean;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(full);
    }
  };
  if (existsSync(start) && statSync(start).isDirectory()) walk(start);
  return found.sort();
}
