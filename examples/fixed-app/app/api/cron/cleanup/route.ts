import { db } from "@/lib/db";

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const { error } = await db.from("orders").delete().eq("paid", false).lt("created_at", new Date(Date.now() - 864e5).toISOString());
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
