import { randomUUID } from 'node:crypto';
import { one, query } from './db';
export function estimateUnitsFromPrompt(prompt) {
    return Math.max(1, Math.ceil(prompt.length / 150) / 10);
}
export function calculateBillableUnits(input) {
    const llmMarkupFactor = Number(process.env.BILLING_LLM_MARKUP_FACTOR ?? 1.3);
    const desktopMinuteRate = Number(process.env.BILLING_DESKTOP_MINUTE_RATE ?? 0.1);
    const browserMinuteRate = Number(process.env.BILLING_BROWSER_MINUTE_RATE ?? 0.05);
    const screenshotRate = Number(process.env.BILLING_SCREENSHOT_RATE ?? 0.01);
    const retryPenalty = Number(process.env.BILLING_RETRY_PENALTY ?? 0.02);
    const llmCost = Number(input.llm_cost_usd ?? 0) * llmMarkupFactor;
    const desktopCost = (Number(input.desktop_seconds ?? 0) / 60) * desktopMinuteRate;
    const browserCost = (Number(input.browser_seconds ?? 0) / 60) * browserMinuteRate;
    const screenshotCost = Number(input.screenshots ?? 0) * screenshotRate;
    const retryCost = Number(input.retries ?? 0) * retryPenalty;
    return Number((llmCost + desktopCost + browserCost + screenshotCost + retryCost).toFixed(4));
}
export async function recordUsageForTask(args) {
    const id = randomUUID();
    const billableUnits = calculateBillableUnits(args.usage);
    await query(`insert into usage_ledger (
      id,
      organization_id,
      user_id,
      task_id,
      run_id,
      raw_llm_cost_usd,
      browser_seconds,
      desktop_seconds,
      screenshots,
      retries,
      billable_units,
      metadata
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`, [
        id,
        args.organizationId,
        args.userId,
        args.taskId,
        args.runId,
        Number(args.usage.llm_cost_usd ?? 0),
        Number(args.usage.browser_seconds ?? 0),
        Number(args.usage.desktop_seconds ?? 0),
        Number(args.usage.screenshots ?? 0),
        Number(args.usage.retries ?? 0),
        billableUnits,
        JSON.stringify(args.usage)
    ]);
    return { usageLedgerId: id, billableUnits };
}
export async function syncUsageToStripe(args) {
    const customer = await one(`select stripe_customer_id, stripe_subscription_status from stripe_customers where user_id = $1`, [args.userId]);
    const eventName = process.env.STRIPE_METER_EVENT_NAME;
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!customer?.stripe_customer_id || !eventName || !secretKey || args.billableUnits <= 0) {
        return { sent: false, reason: 'missing_customer_or_billing_config' };
    }
    const identifier = `usage_${args.usageLedgerId}`;
    await query(`insert into billing_events (id, user_id, usage_ledger_id, stripe_customer_id, meter_event_identifier, status)
     values ($1,$2,$3,$4,$5,'pending')
     on conflict (meter_event_identifier) do nothing`, [randomUUID(), args.userId, args.usageLedgerId, customer.stripe_customer_id, identifier]);
    const body = new URLSearchParams();
    body.set('event_name', eventName);
    body.set('identifier', identifier);
    body.set('timestamp', String(Math.floor(Date.now() / 1000)));
    body.set('payload[stripe_customer_id]', customer.stripe_customer_id);
    body.set('payload[value]', String(args.billableUnits));
    const response = await fetch('https://api.stripe.com/v1/billing/meter_events', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${secretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
    });
    if (!response.ok) {
        const text = await response.text();
        await query(`update billing_events set status = 'failed', error_message = $2 where meter_event_identifier = $1`, [identifier, text.slice(0, 1000)]);
        return { sent: false, reason: text };
    }
    await query(`update billing_events set status = 'sent', sent_at = now() where meter_event_identifier = $1`, [identifier]);
    await query(`update usage_ledger set stripe_reported = true where id = $1`, [args.usageLedgerId]);
    return { sent: true };
}
