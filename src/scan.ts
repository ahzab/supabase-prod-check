import type { Finding, Rule, Severity } from "./types.js";
import { loadProject } from "./project.js";
import { rlsDisabled, rlsNoPolicy, permissiveWritePolicy, securityDefinerSearchPath } from "./rules/database.js";
import { publicSecretEnv, serviceRoleInClient } from "./rules/secrets.js";
import { cronNoAuth, stripeWebhookUnsigned, stripeWebhookIdempotency, healthRoute, serverEmptyCatch } from "./rules/routes.js";

export const RULES: Rule[] = [
  rlsDisabled,
  permissiveWritePolicy,
  securityDefinerSearchPath,
  rlsNoPolicy,
  publicSecretEnv,
  serviceRoleInClient,
  cronNoAuth,
  stripeWebhookUnsigned,
  stripeWebhookIdempotency,
  healthRoute,
  serverEmptyCatch,
];

const RANK: Record<Severity, number> = { error: 0, warn: 1, note: 2 };

export interface ScanResult {
  root: string;
  findings: Finding[];
  counts: Record<Severity, number>;
  scanned: { code: number; migrations: number };
}

export function scan(root: string, opts: { only?: string[]; skip?: string[] } = {}): ScanResult {
  const project = loadProject(root);
  const rules = RULES.filter(
    (r) => (!opts.only?.length || opts.only.includes(r.id)) && !opts.skip?.includes(r.id),
  );
  const findings = rules
    .flatMap((r) => r.run(project))
    .sort(
      (a, b) =>
        RANK[a.severity] - RANK[b.severity] ||
        (a.file ?? "").localeCompare(b.file ?? "") ||
        (a.line ?? 0) - (b.line ?? 0),
    );
  const counts: Record<Severity, number> = { error: 0, warn: 0, note: 0 };
  for (const f of findings) counts[f.severity]++;
  return {
    root,
    findings,
    counts,
    scanned: { code: project.code.length, migrations: project.migrations.length },
  };
}
