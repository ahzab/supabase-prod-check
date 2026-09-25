import { describe, expect, it } from "vitest";
import { hits, project } from "./helpers.js";
import { scan } from "../src/scan.js";

const mig = (sql: string) => ({ "supabase/migrations/0001_init.sql": sql });

describe("rls-disabled", () => {
  it("flags a public table that never enables RLS, at its create statement", () => {
    expect(hits(mig("\n\ncreate table public.orders (id int);"), "rls-disabled")).toEqual([
      "supabase/migrations/0001_init.sql:3",
    ]);
  });

  it("passes when RLS is enabled in a later migration", () => {
    expect(
      hits(
        {
          "supabase/migrations/0001.sql": "create table orders (id int);",
          "supabase/migrations/0002.sql": "alter table only public.orders enable row level security;",
        },
        "rls-disabled",
      ),
    ).toEqual([]);
  });

  it("points at the statement that switches RLS off again", () => {
    const found = scan(
      project({
        "supabase/migrations/0001.sql": "create table t (id int);\nalter table t enable row level security;",
        "supabase/migrations/0002.sql": "select 1;\nalter table public.t disable row level security;",
      }),
      { only: ["rls-disabled"] },
    ).findings;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ file: "supabase/migrations/0002.sql", line: 2 });
    expect(found[0]!.message).toMatch(/switched off again/);
  });

  it("applies migrations in filename order, not directory order", () => {
    expect(
      hits(
        {
          "supabase/migrations/0002_rls.sql": "alter table t enable row level security;",
          "supabase/migrations/0001_t.sql": "create table t (id int);",
        },
        "rls-disabled",
      ),
    ).toEqual([]);
  });

  it("ignores tables in comments, strings and function bodies", () => {
    const sql = [
      "-- create table commented (id int);",
      "/* create table blocked (id int); */",
      "select 'create table quoted (id int);';",
      "create function f() returns void language sql as $$ create table in_body (id int); $$;",
      "create function g() returns void language sql as $fn$ create table tagged (id int); $fn$;",
    ].join("\n");
    expect(hits(mig(sql), "rls-disabled")).toEqual([]);
  });

  it("ignores tables outside the public schema and tables dropped later", () => {
    const sql = "create table private.secrets (id int);\ncreate table tmp (id int);\ndrop table if exists public.tmp;";
    expect(hits(mig(sql), "rls-disabled")).toEqual([]);
  });

  it("handles quoted identifiers and if not exists", () => {
    const sql = 'create table if not exists "public"."Orders" (id int);\nalter table "Orders" enable row level security;';
    expect(hits(mig(sql), "rls-disabled")).toEqual([]);
  });
});

describe("rls-no-policy", () => {
  it("notes a table with RLS on and no policy", () => {
    const found = scan(project(mig("create table log (id int);\nalter table log enable row level security;")), {
      only: ["rls-no-policy"],
    }).findings;
    expect(found.map((f) => f.severity)).toEqual(["note"]);
  });

  it("is quiet once a policy exists", () => {
    const sql =
      "create table log (id int);\nalter table log enable row level security;\ncreate policy p on public.log for select using (true);";
    expect(hits(mig(sql), "rls-no-policy")).toEqual([]);
  });
});

describe("permissive-write-policy", () => {
  const base = "create table t (id int, owner uuid);\nalter table t enable row level security;\n";

  it("flags an insert policy of with check (true) for anon", () => {
    expect(hits(mig(base + "create policy open on t for insert to anon with check (true);"), "permissive-write-policy")).toEqual([
      "supabase/migrations/0001_init.sql:3",
    ]);
  });

  it("treats a policy with no command and no role as for all to public", () => {
    expect(hits(mig(base + "create policy p on t using (true);"), "permissive-write-policy")).toHaveLength(1);
  });

  it("allows read-only public policies and write policies scoped to the user", () => {
    const sql =
      base +
      "create policy r on t for select using (true);\n" +
      "create policy w on t for update to authenticated using (auth.uid() = owner);\n" +
      "create policy s on t for all to service_role using (true);";
    expect(hits(mig(sql), "permissive-write-policy")).toEqual([]);
  });
});

describe("security-definer-search-path", () => {
  const fn = (extra: string) =>
    mig(`create or replace function public.f() returns void language plpgsql security definer ${extra} as $$ begin perform 1; end; $$;`);

  it("flags SECURITY DEFINER without set search_path", () => {
    expect(hits(fn(""), "security-definer-search-path")).toHaveLength(1);
  });

  it("passes when search_path is pinned", () => {
    expect(hits(fn("set search_path = ''"), "security-definer-search-path")).toEqual([]);
  });

  it("ignores SECURITY INVOKER functions", () => {
    expect(
      hits(mig("create function f() returns int language sql as $$ select 1 $$;"), "security-definer-search-path"),
    ).toEqual([]);
  });
});

describe("security-definer-search-path across migrations", () => {
  const unsafe = "create function public.f(a int) returns void language plpgsql security definer as $$ begin end; $$;";

  it("clears when a later migration redefines the function with search_path", () => {
    expect(
      hits(
        {
          "supabase/migrations/0001.sql": unsafe,
          "supabase/migrations/0002.sql":
            "create or replace function public.f(a int) returns void language plpgsql security definer set search_path = public as $$ begin end; $$;",
        },
        "security-definer-search-path",
      ),
    ).toEqual([]);
  });

  it("clears on alter function ... set search_path, and on drop function", () => {
    expect(
      hits({ "supabase/migrations/0001.sql": `${unsafe}\nalter function public.f(a int) set search_path = '';` }, "security-definer-search-path"),
    ).toEqual([]);
    expect(hits({ "supabase/migrations/0001.sql": `${unsafe}\ndrop function if exists f;` }, "security-definer-search-path")).toEqual([]);
  });

  it("keeps overloads separate", () => {
    const fixedOther =
      "create or replace function public.f(b bigint) returns void language plpgsql security definer set search_path = '' as $$ begin end; $$;";
    expect(hits({ "supabase/migrations/0001.sql": `${unsafe}\n${fixedOther}` }, "security-definer-search-path")).toHaveLength(1);
  });
});
