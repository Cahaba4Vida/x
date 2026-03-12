import process from 'node:process';

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  console.error('Missing STRIPE_SECRET_KEY');
  process.exit(1);
}

async function postForm(path, params) {
  const body = new URLSearchParams(params);
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text);
  }
  return JSON.parse(text);
}

const product = await postForm('/v1/products', {
  name: 'OpenClaw Bot Usage'
});

const meter = await postForm('/v1/billing/meters', {
  display_name: 'OpenClaw Bot Usage Units',
  event_name: process.env.STRIPE_METER_EVENT_NAME || 'bot_usage_units',
  'default_aggregation[formula]': 'sum',
  'value_settings[event_payload_key]': 'value',
  'customer_mapping[type]': 'by_id',
  'customer_mapping[event_payload_key]': 'stripe_customer_id'
});

const price = await postForm('/v1/prices', {
  product: product.id,
  currency: 'usd',
  unit_amount_decimal: process.env.STRIPE_UNIT_AMOUNT_DECIMAL || '1',
  'recurring[interval]': 'month',
  'recurring[usage_type]': 'metered',
  'recurring[meter]': meter.id,
  nickname: 'OpenClaw usage price'
});

console.log(JSON.stringify({ product_id: product.id, meter_id: meter.id, price_id: price.id }, null, 2));
