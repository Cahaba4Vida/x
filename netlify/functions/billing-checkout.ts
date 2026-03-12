import type { Handler } from '@netlify/functions';
import { getCurrentContext } from './_lib/auth';
import { one, query } from './_lib/db';
import { badRequest, json, methodNotAllowed, unauthorized } from './_lib/http';
import { getStripe } from './_lib/stripe';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed();
  const context = await getCurrentContext(event);
  if (!context) return unauthorized();

  const priceId = process.env.STRIPE_USAGE_PRICE_ID;
  const successUrl = process.env.STRIPE_SUCCESS_URL;
  const cancelUrl = process.env.STRIPE_CANCEL_URL;
  if (!priceId || !successUrl || !cancelUrl) {
    return badRequest('Missing Stripe price or redirect URLs');
  }

  const stripe = getStripe();
  let mapping = await one<{ stripe_customer_id: string | null }>(
    `select stripe_customer_id from stripe_customers where user_id = $1`,
    [context.user.id]
  );

  let customerId = mapping?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: context.user.email,
      name: context.user.full_name ?? undefined,
      metadata: {
        user_id: context.user.id,
        organization_id: context.organization.id
      }
    });
    customerId = customer.id;
    await query(
      `insert into stripe_customers (user_id, stripe_customer_id, billing_mode)
       values ($1,$2,'metered')
       on conflict (user_id) do update set stripe_customer_id = excluded.stripe_customer_id, updated_at = now()`,
      [context.user.id, customerId]
    );
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: context.user.id,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      user_id: context.user.id,
      organization_id: context.organization.id
    }
  });

  return json(200, { url: session.url });
};
