import { getCurrentContext } from './_lib/auth';
import { one } from './_lib/db';
import { json, methodNotAllowed, unauthorized } from './_lib/http';
export const handler = async (event) => {
    if (event.httpMethod !== 'GET')
        return methodNotAllowed();
    const context = await getCurrentContext(event);
    if (!context)
        return unauthorized();
    const summary = await one(`select
       coalesce((select sum(billable_units) from usage_ledger where user_id = $1 and created_at >= date_trunc('month', now())), 0) as month_units,
       coalesce((select count(*) from tasks where created_by_user_id = $1 and created_at >= date_trunc('month', now())), 0) as month_task_count,
       sc.stripe_customer_id,
       sc.stripe_subscription_status
     from users u
     left join stripe_customers sc on sc.user_id = u.id
     where u.id = $1`, [context.user.id]);
    return json(200, {
        month_units: Number(summary?.month_units ?? 0),
        month_task_count: Number(summary?.month_task_count ?? 0),
        stripe_connected: Boolean(summary?.stripe_customer_id),
        subscription_status: summary?.stripe_subscription_status ?? null
    });
};
