import Stripe from 'stripe';
let cachedStripe = null;
export function getStripe() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
        throw new Error('Missing STRIPE_SECRET_KEY');
    }
    if (!cachedStripe) {
        cachedStripe = new Stripe(key);
    }
    return cachedStripe;
}
