import Stripe from "stripe";
import { markPaid } from "@/lib/orders";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Mistake: trusts any JSON posted here. No signature check, no dedupe.
export async function POST(req: Request) {
  const event = (await req.json()) as Stripe.Event;
  if (event.type === "checkout.session.completed") {
    await markPaid((event.data.object as Stripe.Checkout.Session).client_reference_id!);
  }
  return Response.json({ received: true, stripe: Boolean(stripe) });
}
