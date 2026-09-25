import type { Finding, Rule, SourceFile } from "../types.js";
import { isRouteFile, isServerFile, lineAt } from "../project.js";

/** Line of the exported handler, so a finding points at the code to change. */
function handlerLine(f: SourceFile): number {
  const m = /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\b|export\s+(?:const\s+(?:GET|POST)\b|default\b)|Deno\.serve\(|\bserve\(/.exec(f.text);
  return m ? lineAt(f.text, m.index) : 1;
}

export const cronNoAuth: Rule = {
  id: "cron-no-auth",
  title: "Cron route without a secret check",
  why: "A cron endpoint is a public URL. Without checking CRON_SECRET (or an Authorization header), anyone can trigger the job, as often as they like.",
  run(p) {
    const out: Finding[] = [];
    for (const f of p.code) {
      if (!isRouteFile(f.path) || !/\/cron\//.test(f.path)) continue;
      if (!/CRON_SECRET|authorization/i.test(f.text)) {
        out.push({
          rule: this.id,
          severity: "error",
          message: "cron route runs for any caller: compare the Authorization header to `Bearer ${process.env.CRON_SECRET}` and return 401 otherwise",
          file: f.path,
          line: handlerLine(f),
        });
      }
    }
    return out;
  },
};

function stripeWebhooks(files: SourceFile[]): SourceFile[] {
  return files.filter((f) => isRouteFile(f.path) && /webhook/i.test(f.path) && /stripe/i.test(f.text));
}

export const stripeWebhookUnsigned: Rule = {
  id: "stripe-webhook-unsigned",
  title: "Stripe webhook that never verifies the signature",
  why: "Without stripe.webhooks.constructEvent, the endpoint trusts any JSON posted to it. Anyone can mark an order paid or a subscription active.",
  run(p) {
    return stripeWebhooks(p.code)
      .filter((f) => !/constructEvent(Async)?\s*\(/.test(f.text))
      .map((f) => ({
        rule: this.id,
        severity: "error" as const,
        message: "Stripe webhook parses the body without stripe.webhooks.constructEvent(rawBody, signature, secret)",
        file: f.path,
        line: handlerLine(f),
      }));
  },
};

export const stripeWebhookIdempotency: Rule = {
  id: "stripe-webhook-idempotency",
  title: "Stripe webhook without an idempotency guard",
  why: "Stripe retries deliveries and can send the same event twice. Without recording event.id (or an upsert), a retry grants credits or sends emails twice.",
  run(p) {
    return stripeWebhooks(p.code)
      .filter((f) => !/event\.id|onConflict|on conflict|upsert|idempot|P2002|skipDuplicates/i.test(f.text))
      .map((f) => ({
        rule: this.id,
        severity: "warn" as const,
        message: "no sign of dedupe on event.id: store processed event ids with a unique key before acting",
        file: f.path,
        line: handlerLine(f),
      }));
  },
};

export const healthRoute: Rule = {
  id: "health-route",
  title: "No health route that reads the database",
  why: "Supabase pauses idle free-tier projects. A page can still render while every query fails, so uptime monitoring needs a route that actually queries the database.",
  run(p) {
    if (!p.dependencies.has("next")) return [];
    const health = p.code.find((f) => isRouteFile(f.path) && /\/api\/healthz?(\/route|\.)/.test(f.path));
    if (!health) {
      return [{
        rule: this.id,
        severity: "warn",
        message: "no /api/health route: add one that runs a cheap query and answers 503 when it fails",
      }];
    }
    if (!/supabase|from\(|select|prisma|query/i.test(health.text)) {
      return [{
        rule: this.id,
        severity: "warn",
        message: "health route never touches the database, so a paused project still reports healthy",
        file: health.path,
        line: handlerLine(health),
      }];
    }
    return [];
  },
};

export const serverEmptyCatch: Rule = {
  id: "server-empty-catch",
  title: "Empty catch block in server code",
  why: "A swallowed error in a route handler turns a failed write into a 200 response. The bug only shows up later as missing data.",
  run(p) {
    const out: Finding[] = [];
    for (const f of p.code) {
      if (!isServerFile(f)) continue;
      for (const m of f.text.matchAll(/catch\s*(\([^)]*\))?\s*\{\s*\}/g)) {
        out.push({
          rule: this.id,
          severity: "warn",
          message: "empty catch: log the error and return a non-2xx status, or let it throw",
          file: f.path,
          line: lineAt(f.text, m.index ?? 0),
        });
      }
    }
    return out;
  },
};
