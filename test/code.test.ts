import { describe, expect, it } from "vitest";
import { hits, NEXT_PKG } from "./helpers.js";

describe("public-secret-env", () => {
  it("flags secret-looking names behind public prefixes in code and env files", () => {
    expect(
      hits(
        {
          ".env.example": "NEXT_PUBLIC_URL=x\nNEXT_PUBLIC_STRIPE_SECRET_KEY=\n",
          "lib/a.ts": "const k = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;",
        },
        "public-secret-env",
      ),
    ).toEqual([".env.example:2", "lib/a.ts:1"]);
  });

  it("allows the public anon key and server-only secrets", () => {
    expect(
      hits({ ".env.example": "NEXT_PUBLIC_SUPABASE_ANON_KEY=\nSTRIPE_SECRET_KEY=\nSUPABASE_SERVICE_ROLE_KEY=\n" }, "public-secret-env"),
    ).toEqual([]);
  });

  it("does not read test files", () => {
    expect(hits({ "lib/a.test.ts": "process.env.NEXT_PUBLIC_API_SECRET" }, "public-secret-env")).toEqual([]);
  });
});

describe("service-role-in-client", () => {
  it("flags a client component that reads the service role key", () => {
    expect(
      hits({ "components/Admin.tsx": '"use client";\n\nconst k = process.env.SUPABASE_SERVICE_ROLE_KEY;' }, "service-role-in-client"),
    ).toEqual(["components/Admin.tsx:3"]);
  });

  it("allows the key in server code", () => {
    expect(hits({ "lib/db.ts": 'import "server-only";\nprocess.env.SUPABASE_SERVICE_ROLE_KEY' }, "service-role-in-client")).toEqual([]);
  });

  it("treats all of src/ as browser code in a Vite app", () => {
    expect(
      hits(
        { "package.json": JSON.stringify({ dependencies: { vite: "5" } }), "src/api.ts": "createClient(url, import.meta.env.SERVICE_ROLE)" },
        "service-role-in-client",
      ),
    ).toEqual(["src/api.ts:1"]);
  });
});

describe("cron-no-auth", () => {
  it("flags an app-router cron route with no secret check, at its handler", () => {
    expect(hits({ "app/api/cron/sync/route.ts": "import x from 'y';\n\nexport async function GET() { return new Response(); }" }, "cron-no-auth")).toEqual([
      "app/api/cron/sync/route.ts:3",
    ]);
  });

  it("accepts CRON_SECRET or an Authorization check, and pages/api routes", () => {
    expect(
      hits(
        {
          "app/api/cron/a/route.ts": "if (req.headers.get('authorization') !== x) return;",
          "pages/api/cron/b.ts": "if (req.query.key !== process.env.CRON_SECRET) return;",
        },
        "cron-no-auth",
      ),
    ).toEqual([]);
  });

  it("ignores routes outside cron/", () => {
    expect(hits({ "app/api/items/route.ts": "export async function GET() {}" }, "cron-no-auth")).toEqual([]);
  });
});

describe("stripe webhooks", () => {
  const unsigned = { "app/api/stripe/webhook/route.ts": "import Stripe from 'stripe';\nexport async function POST(req) { const e = await req.json(); }" };
  const signed = {
    "app/api/webhooks/stripe/route.ts":
      "import Stripe from 'stripe';\nexport async function POST(req) { const e = stripe.webhooks.constructEvent(b, s, k); await db.insert({ id: event.id }); }",
  };

  it("flags a webhook that never verifies the signature", () => {
    expect(hits(unsigned, "stripe-webhook-unsigned")).toEqual(["app/api/stripe/webhook/route.ts:2"]);
  });

  it("warns when a webhook shows no idempotency guard", () => {
    expect(hits(unsigned, "stripe-webhook-idempotency")).toHaveLength(1);
  });

  it("passes a verified, deduped webhook", () => {
    expect(hits(signed, "stripe-webhook-unsigned")).toEqual([]);
    expect(hits(signed, "stripe-webhook-idempotency")).toEqual([]);
  });

  it("ignores webhook routes that are not Stripe's", () => {
    expect(hits({ "app/api/webhooks/github/route.ts": "export async function POST() {}" }, "stripe-webhook-unsigned")).toEqual([]);
  });
});

describe("health-route", () => {
  it("warns when a Next.js app has no health route", () => {
    expect(hits({ "package.json": NEXT_PKG }, "health-route")).toEqual(["(project)"]);
  });

  it("warns when the health route never touches the database", () => {
    expect(
      hits({ "package.json": NEXT_PKG, "app/api/health/route.ts": "export async function GET() { return Response.json({ ok: true }); }" }, "health-route"),
    ).toEqual(["app/api/health/route.ts:1"]);
  });

  it("passes a health route that queries, and skips non-Next projects", () => {
    expect(
      hits({ "package.json": NEXT_PKG, "app/api/health/route.ts": "await supabase.from('t').select('id')" }, "health-route"),
    ).toEqual([]);
    expect(hits({ "package.json": "{}" }, "health-route")).toEqual([]);
  });
});

describe("server-empty-catch", () => {
  it("flags empty catch blocks in route handlers and server-only libs", () => {
    expect(
      hits(
        {
          "app/api/x/route.ts": "try { a() } catch {}",
          "lib/db.ts": "import 'server-only';\n\ntry { a() } catch (e) {  }",
        },
        "server-empty-catch",
      ),
    ).toEqual(["app/api/x/route.ts:1", "lib/db.ts:3"]);
  });

  it("ignores client components and catches that handle the error", () => {
    expect(
      hits(
        {
          "components/A.tsx": '"use client";\ntry { localStorage.x } catch {}',
          "app/api/y/route.ts": "try { a() } catch (e) { log(e) }",
        },
        "server-empty-catch",
      ),
    ).toEqual([]);
  });
});
