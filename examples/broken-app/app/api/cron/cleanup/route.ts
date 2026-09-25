import { createClient } from "@supabase/supabase-js";

// Mistake: nothing checks who is calling, so anyone can run the cleanup.
export async function GET() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  await supabase.from("orders").delete().lt("created_at", new Date(Date.now() - 864e5).toISOString());
  return Response.json({ ok: true });
}
