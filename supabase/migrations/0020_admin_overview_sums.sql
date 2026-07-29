-- 0020_admin_overview_sums.sql
-- PostgREST column.sum() aggregates are not reliable across projects (often
-- disabled or rejected). Overview/KPI money totals must use SECURITY DEFINER
-- RPCs instead — same pattern as 0018's distinct-count helpers.

begin;

create or replace function fn_admin_overview_metrics(
  p_month_start timestamptz,
  p_since_7d timestamptz,
  p_since_30d timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'revenue_all_time_minor_units',
      coalesce((select sum(amount_minor_units) from payments where status = 'success'), 0),
    'revenue_mtd_minor_units',
      coalesce((
        select sum(amount_minor_units)
        from payments
        where status = 'success'
          and created_at >= p_month_start
      ), 0),
    'wallet_purchased',
      coalesce((select sum(lifetime_purchased) from credit_wallets), 0),
    'wallet_consumed',
      coalesce((select sum(lifetime_consumed) from credit_wallets), 0),
    'wallet_held',
      coalesce((select sum(held_balance) from credit_wallets), 0),
    'active_users_7d',
      (select count(distinct user_id) from enrichment_runs where created_at >= p_since_7d),
    'active_users_30d',
      (select count(distinct user_id) from enrichment_runs where created_at >= p_since_30d),
    'verified_profiles',
      (select count(*) from profiles),
    'onboarded_profiles',
      (select count(*) from profiles where company is not null)
  );
$$;

-- Generic payment amount sum for transaction KPIs (optional status + optional
-- user-id filter for email search scoping).
create or replace function fn_admin_sum_payment_amounts(
  p_status text default null,
  p_user_ids uuid[] default null,
  p_gateway_ilike text default null
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount_minor_units), 0)::bigint
  from payments
  where (p_status is null or status = p_status)
    and (p_user_ids is null or user_id = any (p_user_ids))
    and (p_gateway_ilike is null or gateway_payment_id ilike ('%' || p_gateway_ilike || '%'));
$$;

create or replace function fn_admin_sum_wallet_lifetime_consumed()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(lifetime_consumed), 0)::bigint from credit_wallets;
$$;

revoke all on function fn_admin_overview_metrics(timestamptz, timestamptz, timestamptz) from public;
revoke all on function fn_admin_sum_payment_amounts(text, uuid[], text) from public;
revoke all on function fn_admin_sum_wallet_lifetime_consumed() from public;

grant execute on function fn_admin_overview_metrics(timestamptz, timestamptz, timestamptz) to service_role;
grant execute on function fn_admin_sum_payment_amounts(text, uuid[], text) to service_role;
grant execute on function fn_admin_sum_wallet_lifetime_consumed() to service_role;

commit;
