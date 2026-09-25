import type { Finding, Project, Rule, SourceFile } from "../types.js";
import { isClientFile, lineAt } from "../project.js";

const PUBLIC_SECRET = /\b(?:NEXT_PUBLIC|VITE|EXPO_PUBLIC|PUBLIC)_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE_KEY)[A-Z0-9_]*\b/g;
const SERVICE_ROLE = /service_role|SERVICE_ROLE/g;

function matches(file: SourceFile, re: RegExp): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  for (const m of file.text.matchAll(re)) out.push({ text: m[0], line: lineAt(file.text, m.index ?? 0) });
  return out;
}

/** A Vite single-page app has no server: everything under src/ ships to the browser. */
function isBrowserBundle(p: Project, file: SourceFile): boolean {
  if (isClientFile(file)) return true;
  const spa = p.dependencies.has("vite") && !p.dependencies.has("next");
  return spa && file.path.startsWith("src/");
}

export const publicSecretEnv: Rule = {
  id: "public-secret-env",
  title: "Secret behind a public env prefix",
  why: "NEXT_PUBLIC_, VITE_ and PUBLIC_ variables are inlined into the JavaScript every visitor downloads. A secret with that prefix is published the moment you deploy.",
  run(p) {
    const out: Finding[] = [];
    for (const f of [...p.code, ...p.config]) {
      for (const m of matches(f, PUBLIC_SECRET)) {
        out.push({
          rule: this.id,
          severity: "error",
          message: `${m.text} is inlined into the browser bundle: drop the public prefix and read it only on the server`,
          file: f.path,
          line: m.line,
        });
      }
    }
    return out;
  },
};

export const serviceRoleInClient: Rule = {
  id: "service-role-in-client",
  title: "Service role key used in browser code",
  why: "The service role key bypasses every RLS policy. Referenced from a client component or a Vite app, it ends up in the bundle and gives anyone full database access.",
  run(p) {
    const out: Finding[] = [];
    for (const f of p.code) {
      if (!isBrowserBundle(p, f)) continue;
      const first = matches(f, SERVICE_ROLE)[0];
      if (first) {
        out.push({
          rule: this.id,
          severity: "error",
          message: "browser code references the service role key: move this call to a route handler or server action",
          file: f.path,
          line: first.line,
        });
      }
    }
    return out;
  },
};
