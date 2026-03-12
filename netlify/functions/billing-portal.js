import { getCurrentContext } from './_lib/auth';
import { one } from './_lib/db';
import { badRequest, json, methodNotAllowed, unauthorized } from './_lib/http';
import { getStripe } from './_lib/stripe';
export const handler = async (event) => {
    if (event.httpMethod !== 'POST')
        return methodNotAllowed();
    const context = await getCurrentContext(event);
    if (!context)
        return unauthorized();
    const baseUrl = process.env.APP_BASE_URL;
    if (!baseUrl)
        return badRequest('Missing APP_BASE_URL');
    const mapping = await one(`select stripe_customer_id from stripe_customers where user_id = $1`, [context.user.id]);
    if (!mapping?.stripe_customer_id)
        return badRequest('Stripe customer not found');
    const session = await getStripe().billingPortal.sessions.create({
        customer: mapping.stripe_customer_id,
        return_url: `${baseUrl}/app`
    });
    return json(200, { url: session.url });
};
