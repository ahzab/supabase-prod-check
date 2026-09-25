import { describe, expect, it, beforeAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cli.js");
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });

beforeAll(() => {
  execFileSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], { cwd: root });
});

describe("cli", () => {
  it("finds every planted mistake in the broken example and exits 1", () => {
    const r = run("examples/broken-app", "--json");
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.counts).toEqual({ error: 6, warn: 5, note: 1 });
    const rules = new Set(out.findings.map((f: { rule: string }) => f.rule));
    expect(rules.size).toBe(11);
  });

  it("passes the fixed example cleanly, even with --strict", () => {
    const r = run("examples/fixed-app", "--strict");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/0 error\(s\), 0 warning\(s\), 0 note\(s\)/);
  });

  it("exits 0 on warnings alone unless --strict", () => {
    const only = ["examples/broken-app", "--only", "health-route"];
    expect(run(...only).status).toBe(0);
    expect(run(...only, "--strict").status).toBe(1);
  });

  it("rejects unknown options, unknown rules and missing directories with exit 2", () => {
    expect(run("--nope").status).toBe(2);
    expect(run(".", "--only", "not-a-rule").status).toBe(2);
    expect(run("does/not/exist").status).toBe(2);
  });

  it("lists every rule with --rules", () => {
    const r = run("--rules");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/rls-disabled/);
    expect(r.stdout).toMatch(/stripe-webhook-unsigned/);
  });
});
