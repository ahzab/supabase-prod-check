import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Project, SourceFile } from "./types.js";

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".vercel", "dist", "build", "out", "coverage", ".turbo", "__tests__"]);
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const CONFIG_FILE = /^(\.env(\..+)?|next\.config\.[cm]?[jt]s|vercel\.json|vite\.config\.[cm]?[jt]s)$/;
const MAX_BYTES = 512 * 1024;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (st.size <= MAX_BYTES) out.push(full);
  }
}

const rel = (root: string, p: string) => relative(root, p).split(sep).join("/");

export function loadProject(root: string): Project {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`not a directory: ${root}`);
  }
  const files: string[] = [];
  walk(root, files);

  const code: SourceFile[] = [];
  const migrations: SourceFile[] = [];
  const config: SourceFile[] = [];
  for (const full of files) {
    const path = rel(root, full);
    const base = path.slice(path.lastIndexOf("/") + 1);
    if (/^supabase\/migrations\/[^/]+\.sql$/.test(path)) {
      migrations.push({ path, text: readFileSync(full, "utf8") });
    } else if (CODE_EXT.test(path) && !TEST_FILE.test(path) && !CONFIG_FILE.test(base)) {
      code.push({ path, text: readFileSync(full, "utf8") });
    } else if (CONFIG_FILE.test(base) && !path.includes("/")) {
      config.push({ path, text: readFileSync(full, "utf8") });
    }
  }
  migrations.sort((a, b) => a.path.localeCompare(b.path));

  const dependencies = new Set<string>();
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      for (const k of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) dependencies.add(k);
    } catch {
      // A broken package.json is not this tool's finding to make; rules that need
      // dependencies simply see none.
    }
  }
  return { root, code, migrations, config, dependencies };
}

/** 1-based line number of a character offset. */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** A 'use client' directive in the first few statements marks a browser bundle. */
export function isClientFile(file: SourceFile): boolean {
  const head = file.text.split("\n").slice(0, 5).join("\n");
  return /^\s*["']use client["']/m.test(head);
}

/** Route handlers: Next.js app router route files, pages/api files, Supabase edge functions. */
export function isRouteFile(path: string): boolean {
  return (
    /(^|\/)app\/api\/.+\/route\.[cm]?[jt]sx?$/.test(path) ||
    /(^|\/)pages\/api\/.+\.[cm]?[jt]sx?$/.test(path) ||
    /^supabase\/functions\/[^/]+\/index\.[jt]s$/.test(path)
  );
}

/** Code that runs on the server: route handlers, server actions and server-only libs. */
export function isServerFile(file: SourceFile): boolean {
  if (isClientFile(file)) return false;
  if (isRouteFile(file.path)) return true;
  if (/^\s*["']use server["']/m.test(file.text.split("\n").slice(0, 5).join("\n"))) return true;
  return /(^|\/)(lib|server|utils)\//.test(file.path) && /server-only|createServerClient|SERVICE_ROLE/.test(file.text);
}
