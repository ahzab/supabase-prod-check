export type Severity = "error" | "warn" | "note";

export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  /** Repo-relative path, when the finding points at a file. */
  file?: string;
  line?: number;
}

export interface SourceFile {
  /** Repo-relative path with forward slashes. */
  path: string;
  text: string;
}

/** Everything a rule may look at. Built once per scan, shared by every rule. */
export interface Project {
  root: string;
  /** JS/TS source outside node_modules, build output and tests. */
  code: SourceFile[];
  /** supabase/migrations/*.sql in filename order (the order Supabase applies them). */
  migrations: SourceFile[];
  /** .env examples and framework config that can declare env var names. */
  config: SourceFile[];
  dependencies: Set<string>;
}

export interface Rule {
  id: string;
  title: string;
  /** Why the rule exists, shown by --explain and in the README table. */
  why: string;
  run(project: Project): Finding[];
}
