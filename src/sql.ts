import type { SourceFile } from "./types.js";
import { lineAt } from "./project.js";

export interface Statement {
  file: string;
  line: number;
  /** Lowercased, comments removed, quotes stripped, whitespace collapsed. */
  sql: string;
}

/**
 * Blank out comments and string literals while keeping every character's offset,
 * so a statement can be matched on its normalized form and still report the line
 * it came from. Dollar-quoted bodies are blanked too: a function body is code the
 * database runs, not DDL this tool should read as table definitions.
 */
function blank(text: string): string {
  const out = text.split("");
  const fill = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
  };
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === "--") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      fill(i, stop);
      i = stop;
    } else if (two === "/*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      fill(i, stop);
      i = stop;
    } else if (text[i] === "'") {
      let j = i + 1;
      while (j < text.length && !(text[j] === "'" && text[j + 1] !== "'")) j += text[j] === "'" ? 2 : 1;
      fill(i + 1, j);
      i = j + 1;
    } else if (text[i] === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(i));
      if (!tag) { i++; continue; }
      const end = text.indexOf(tag[0], i + tag[0].length);
      const stop = end === -1 ? text.length : end;
      fill(i + tag[0].length, stop);
      i = stop + (end === -1 ? 0 : tag[0].length);
    } else {
      i++;
    }
  }
  return out.join("");
}

export function statements(files: SourceFile[]): Statement[] {
  const result: Statement[] = [];
  for (const f of files) {
    const clean = blank(f.text);
    let start = 0;
    for (let i = 0; i <= clean.length; i++) {
      if (i === clean.length || clean[i] === ";") {
        const raw = clean.slice(start, i);
        const lead = raw.search(/\S/);
        if (lead !== -1) {
          result.push({
            file: f.path,
            line: lineAt(f.text, start + lead),
            sql: raw.toLowerCase().replace(/"/g, "").replace(/\s+/g, " ").trim(),
          });
        }
        start = i + 1;
      }
    }
  }
  return result;
}

/** Table name without the public schema, or null for a table in another schema. */
export function publicTable(name: string): string | null {
  if (!name.includes(".")) return name;
  const [schema, table] = name.split(".");
  return schema === "public" && table ? table : null;
}
