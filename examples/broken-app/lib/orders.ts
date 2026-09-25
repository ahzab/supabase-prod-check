import "server-only";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function markPaid(orderId: string) {
  try {
    await db.from("orders").update({ paid: true }).eq("id", orderId);
  } catch {}
}
