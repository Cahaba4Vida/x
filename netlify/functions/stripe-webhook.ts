import type { Handler } from '@netlify/functions';
import { query, one } from './_lib/db';
import { json, methodNotAllowed, serverError } from './_lib/http';
import { getStripe } from './_lib/stripe';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed();

  const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret || !event.body) {
    return serverError('Missing Stripe webhook config');
  }

  const stripe = getStripe();

  try {
    const existing = event.headers['stripe-event-id']
      ? await one<{ id: string }>(`select id from webhook_events where id = $1`, [event.headers['stripe-event-id']])
      : null;
    if (existing) return json(200, { received: true });

    const stripeEvent = stripe.webhooks.constructEvent(event.body, signature, secret);
    await query(
      `insert into webhook_events (id, provider, event_type) values ($1,'stripe',$2) on conflict do nothing`,
      [stripeEvent.id, stripeEvent.type]
    );

    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        const userId = session.client_reference_id || session.metadata?.user_id;
        if (userId && session.customer) {
          await query(
            `insert into stripe_customers (user_id, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, billing_mode)
             values ($1,$2,$3,'active','metered')
             on conflict (user_id) do update set
               stripe_customer_id = excluded.stripe_customer_id,
               stripe_subscription_id = excluded.stripe_subscription_id,
               stripe_subscription_status = 'active',
               updated_at = now()`,
            [userId, String(session.customer), session.subscription ? String(session.subscription) : null]
          );
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = stripeEvent.data.object;
        await query(
          `update stripe_customers set stripe_subscription_status = $2, updated_at = now() where stripe_subscription_id = $1`,
          [subscription.id, subscription.status]
        );
        break;
      }
      default:
        break;
    }

    await query(`update webhook_events set processed_at = now() where id = $1`, [stripeEvent.id]);
    return json(200, { received: true });
  } catch (error) {
    return serverError((error as Error).message);
  }
};
