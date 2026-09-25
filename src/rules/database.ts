import type { Finding, Rule } from "../types.js";
import { statements, publicTable, type Statement } from "../sql.js";

interface TableState {
  created: Statement;
  rls: boolean;
  /** The statement that switched RLS off again, if one did. */
  disabledBy?: Statement;
  policies: number;
}

/**
 * Replay the migrations in order and track each public table's RLS state and
 * policy count. Replaying (rather than grepping for the two statements) is what
 * catches a later `disable row level security` or a table that was dropped.
 */
function replay(stmts: Statement[]): Map<string, TableState> {
  const tables = new Map<string, TableState>();
  for (const s of stmts) {
    let m = /^create table (?:if not exists )?([a-z0-9_.]+)/.exec(s.sql);
    if (m?.[1]) {
      const t = publicTable(m[1]);
      if (t && !tables.has(t)) tables.set(t, { created: s, rls: false, policies: 0 });
      continue;
    }
    m = /^drop table (?:if exists )?([a-z0-9_.]+)/.exec(s.sql);
    if (m?.[1]) {
      const t = publicTable(m[1]);
      if (t) tables.delete(t);
      continue;
    }
    m = /^alter table (?:if exists )?(?:only )?([a-z0-9_.]+) (enable|disable) row level security/.exec(s.sql);
    if (m?.[1]) {
      const t = publicTable(m[1]);
      const state = t ? tables.get(t) : undefined;
      if (state) {
        state.rls = m[2] === "enable";
        state.disabledBy = state.rls ? undefined : s;
      }
      continue;
    }
    m = /^create policy .+? on ([a-z0-9_.]+)/.exec(s.sql);
    if (m?.[1]) {
      const t = publicTable(m[1]);
      const state = t ? tables.get(t) : undefined;
      if (state) state.policies++;
    }
  }
  return tables;
}

export const rlsDisabled: Rule = {
  id: "rls-disabled",
  title: "Table without row level security",
  why: "Supabase exposes every public table through its REST API with the anon key, which ships in the browser. Without RLS, anyone can read and write the whole table.",
  run(p) {
    const out: Finding[] = [];
    for (const [name, t] of replay(statements(p.migrations))) {
      if (t.rls) continue;
      const at = t.disabledBy ?? t.created;
      out.push({
        rule: this.id,
        severity: "error",
        message: t.disabledBy
          ? `table "${name}" has row level security switched off again here: remove the disable or re-enable it in a later migration`
          : `table "${name}" never enables row level security: add \`alter table ${name} enable row level security;\``,
        file: at.file,
        line: at.line,
      });
    }
    return out;
  },
};

export const rlsNoPolicy: Rule = {
  id: "rls-no-policy",
  title: "RLS enabled but no policy",
  why: "RLS with no policy denies every client request. That is correct for a server-only table, and a silent empty result for one the app reads from the browser.",
  run(p) {
    const out: Finding[] = [];
    for (const [name, t] of replay(statements(p.migrations))) {
      if (t.rls && t.policies === 0) {
        out.push({
          rule: this.id,
          severity: "note",
          message: `table "${name}" has RLS on and no policy, so only the service role can reach it. Fine if that is intended`,
          file: t.created.file,
          line: t.created.line,
        });
      }
    }
    return out;
  },
};

export const permissiveWritePolicy: Rule = {
  id: "permissive-write-policy",
  title: "Write policy open to everyone",
  why: "A policy of `using (true)` or `with check (true)` on insert, update or delete for anon or public turns RLS back off for writes. It is usually a placeholder that shipped.",
  run(p) {
    const out: Finding[] = [];
    for (const s of statements(p.migrations)) {
      const m = /^create policy (.+?) on ([a-z0-9_.]+)(.*)$/.exec(s.sql);
      if (!m) continue;
      const rest = m[3] ?? "";
      const cmd = /\bfor (all|select|insert|update|delete)\b/.exec(rest)?.[1] ?? "all";
      if (cmd === "select") continue;
      const roles = /\bto ([a-z_, ]+?)(?= using| with check|$)/.exec(rest)?.[1] ?? "public";
      const openRole = /\b(public|anon)\b/.test(roles);
      const alwaysTrue = /\b(using|with check) \(\s*true\s*\)/.test(rest);
      if (openRole && alwaysTrue) {
        out.push({
          rule: this.id,
          severity: "warn",
          message: `policy ${m[1]} on ${m[2]} lets ${roles.trim()} ${cmd === "all" ? "write" : cmd} any row: scope it to auth.uid()`,
          file: s.file,
          line: s.line,
        });
      }
    }
    return out;
  },
};

/** Function identity: name plus its argument list, so overloads stay separate. */
function fnKey(name: string, args: string): string {
  return `${publicTable(name) ?? name}(${args.replace(/\s+/g, " ").trim()})`;
}

export const securityDefinerSearchPath: Rule = {
  id: "security-definer-search-path",
  title: "SECURITY DEFINER function without a fixed search_path",
  why: "A SECURITY DEFINER function runs with its owner's rights. Without `set search_path`, a caller can shadow the tables or functions it uses and run code as that owner.",
  run(p) {
    // Replay in order: a later `create or replace` or `alter function ... set
    // search_path` fixes an earlier definition, and a dropped function is gone.
    const unsafe = new Map<string, Statement>();
    for (const s of statements(p.migrations)) {
      let m = /^create (?:or replace )?function ([a-z0-9_.]+) ?\(([^)]*)\)/.exec(s.sql);
      if (m?.[1]) {
        const key = fnKey(m[1], m[2] ?? "");
        if (/\bsecurity definer\b/.test(s.sql) && !/\bset search_path\b/.test(s.sql)) unsafe.set(key, s);
        else unsafe.delete(key);
        continue;
      }
      m = /^alter function ([a-z0-9_.]+) ?(?:\(([^)]*)\))? .*\bset search_path\b/.exec(s.sql);
      if (m?.[1]) {
        const name = m[1];
        if (m[2] !== undefined) unsafe.delete(fnKey(name, m[2]));
        else for (const k of [...unsafe.keys()]) if (k.startsWith(`${publicTable(name) ?? name}(`)) unsafe.delete(k);
        continue;
      }
      m = /^drop function (?:if exists )?([a-z0-9_.]+) ?(?:\(([^)]*)\))?/.exec(s.sql);
      if (m?.[1]) {
        const name = m[1];
        if (m[2] !== undefined) unsafe.delete(fnKey(name, m[2]));
        else for (const k of [...unsafe.keys()]) if (k.startsWith(`${publicTable(name) ?? name}(`)) unsafe.delete(k);
      }
    }
    return [...unsafe.entries()].map(([key, s]) => ({
      rule: this.id,
      severity: "warn" as const,
      message: `function ${key} is SECURITY DEFINER without \`set search_path = ''\``,
      file: s.file,
      line: s.line,
    }));
  },
};
