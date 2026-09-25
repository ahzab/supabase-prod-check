#!/usr/bin/env node
import { resolve } from "node:path";
import { RULES, scan, type ScanResult } from "./scan.js";
import type { Severity } from "./types.js";

const HELP = `supabase-prod-check [dir] [options]

Static checks for Supabase + Next.js apps. Reads supabase/migrations and your
source; never connects to a database or runs your code.

Options
  --json            machine-readable output
  --strict          exit 1 on warnings too (for CI)
  --only <ids>      comma-separated rule ids to run
  --skip <ids>      comma-separated rule ids to skip
  --rules           list every rule and why it exists
  -h, --help        show this help

Exit codes: 0 clean, 1 findings at the failing level, 2 usage error.`;

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const LABEL: Record<Severity, string> = {
  error: paint("31;1", "error"),
  warn: paint("33;1", "warn "),
  note: paint("36", "note "),
};

function parseArgs(argv: string[]) {
  const opts = { dir: ".", json: false, strict: false, only: [] as string[], skip: [] as string[], rules: false, help: false };
  const list = (v: string | undefined, flag: string) => {
    if (!v) throw new Error(`${flag} needs a value`);
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") opts.json = true;
    else if (a === "--strict") opts.strict = true;
    else if (a === "--only") opts.only = list(argv[++i], a);
    else if (a === "--skip") opts.skip = list(argv[++i], a);
    else if (a === "--rules") opts.rules = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
    else opts.dir = a;
  }
  const known = new Set(RULES.map((r) => r.id));
  for (const id of [...opts.only, ...opts.skip]) if (!known.has(id)) throw new Error(`unknown rule ${id} (see --rules)`);
  return opts;
}

function printHuman(r: ScanResult): void {
  for (const f of r.findings) {
    const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "(project)";
    console.log(`${LABEL[f.severity]}  ${paint("1", where)}  ${f.message}  ${paint("2", f.rule)}`);
  }
  if (r.findings.length) console.log("");
  const { error, warn, note } = r.counts;
  console.log(
    `${r.scanned.migrations} migration(s), ${r.scanned.code} source file(s) checked: ` +
      `${paint(error ? "31;1" : "32", `${error} error(s)`)}, ${warn} warning(s), ${note} note(s)`,
  );
}

function main(): number {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`supabase-prod-check: ${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  if (opts.rules) {
    for (const r of RULES) console.log(`${paint("1", r.id)}  ${r.title}\n  ${r.why}\n`);
    return 0;
  }
  let result: ScanResult;
  try {
    result = scan(resolve(opts.dir), { only: opts.only, skip: opts.skip });
  } catch (e) {
    console.error(`supabase-prod-check: ${(e as Error).message}`);
    return 2;
  }
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
  const failing = result.counts.error + (opts.strict ? result.counts.warn : 0);
  return failing > 0 ? 1 : 0;
}

process.exitCode = main();
