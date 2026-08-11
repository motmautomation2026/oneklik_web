-- 0023_launch_plan.sql
-- Pricing catalog change: new Launch plan added below Starter, Business
-- retired (product has not launched — no real subscribers to migrate).
-- Pricing itself stays in backend/src/lib/creditPacks.ts; this migration only
-- updates the plan-rank helper used by fn_complete_subscription_payment to
-- classify renewals as upgrade/downgrade/same (rollover eligibility).

begin;

create or replace function fn_plan_rank(p_plan_id text)
returns integer
language sql
immutable
as $$
  select case p_plan_id
    when 'launch' then 1
    when 'starter' then 2
    when 'growth' then 3
    else 0
  end;
$$;

commit;
