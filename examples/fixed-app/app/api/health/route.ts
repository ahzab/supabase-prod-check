import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await db.from("profiles").select("id", { head: true, count: "exact" }).limit(1);
  return error
    ? Response.json({ ok: false, db: error.message }, { status: 503 })
    : Response.json({ ok: true });
}
