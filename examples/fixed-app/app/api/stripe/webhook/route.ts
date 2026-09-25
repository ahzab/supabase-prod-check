import Stripe from "stripe";
import { db } from "@/lib/db";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), req.headers.get("stripe-signature")!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return new Response("bad signature", { status: 400 });
  }
  // Insert the event id first: a retried delivery hits the primary key and stops here.
  const { error: seen } = await db.from("stripe_events").insert({ id: event.id });
  if (seen) return Response.json({ received: true, duplicate: true });

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const { error } = await db.from("orders").update({ paid: true }).eq("id", session.client_reference_id!);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ received: true });
}
