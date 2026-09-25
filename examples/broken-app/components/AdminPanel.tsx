"use client";
import { createClient } from "@supabase/supabase-js";

// Mistake: the service role key in a client component bypasses every policy,
// and Next.js would need it exposed to the browser for this to even run.
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export function AdminPanel() {
  return <button onClick={() => admin.from("orders").delete().neq("id", 0)}>Reset orders</button>;
}
