import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";
import { scan } from "../src/scan.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** Write a throwaway project from a { path: contents } map and return its root. */
export function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "spc-"));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** Findings for one rule, as "file:line" strings, for compact assertions. */
export function hits(files: Record<string, string>, rule: string): string[] {
  return scan(project(files), { only: [rule] }).findings.map((f) => (f.file ? `${f.file}:${f.line}` : "(project)"));
}

export const NEXT_PKG = JSON.stringify({ dependencies: { next: "15.0.0" } });
