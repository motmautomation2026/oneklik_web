-- 0018_admin_kpi_aggregates.sql
-- Replace admin dashboard JS full-table scans (forEachPage / MAX_PAGES) with
-- SQL aggregates so KPIs stay correct past ~20k rows.
--
-- All functions are SECURITY DEFINER, granted to service_role only (the
-- admin API uses the service role). They never expose row-level PII beyond
-- what the existing admin endpoints already return as aggregates.

begin;

-- ── Distinct active / paid users ────────────────────────────────────────

create or replace function fn_admin_distinct_run_users(p_since timestamptz default null)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct user_id)::bigint
  from enrichment_runs
  where (p_since is null or created_at >= p_since);
$$;

create or replace function fn_admin_distinct_paid_users()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct user_id)::bigint
  from payments
  where status = 'success';
$$;

-- ── Daily trends (signups / revenue / credits by run_type) ───────────────

create or replace function fn_admin_trends(p_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 180));
  v_since date := (current_timestamp at time zone 'utc')::date - v_days;
begin
  return coalesce(
    (
      with days as (
        select generate_series(v_since, (current_timestamp at time zone 'utc')::date, interval '1 day')::date as d
      ),
      signups as (
        select (created_at at time zone 'utc')::date as d, count(*)::int as n
        from profiles
        where created_at >= v_since::timestamptz
        group by 1
      ),
      revenue as (
        select (created_at at time zone 'utc')::date as d, coalesce(sum(amount_minor_units), 0)::bigint as n
        from payments
        where status = 'success'
          and created_at >= v_since::timestamptz
        group by 1
      ),
      credits as (
        select
          (completed_at at time zone 'utc')::date as d,
          run_type,
          coalesce(sum(credits_charged), 0)::bigint as n
        from enrichment_runs
        where completed_at is not null
          and completed_at >= v_since::timestamptz
          and run_type in ('company_search', 'people_search', 'email_enrich', 'mobile_enrich')
        group by 1, 2
      ),
      credits_pivot as (
        select
          d,
          coalesce(sum(n) filter (where run_type = 'company_search'), 0)::bigint as company_search,
          coalesce(sum(n) filter (where run_type = 'people_search'), 0)::bigint as people_search,
          coalesce(sum(n) filter (where run_type = 'email_enrich'), 0)::bigint as email_enrich,
          coalesce(sum(n) filter (where run_type = 'mobile_enrich'), 0)::bigint as mobile_enrich
        from credits
        group by d
      )
      select jsonb_agg(
        jsonb_build_object(
          'date', to_char(days.d, 'YYYY-MM-DD'),
          'signups', coalesce(signups.n, 0),
          'revenue_minor_units', coalesce(revenue.n, 0),
          'credits_consumed', jsonb_build_object(
            'company_search', coalesce(credits_pivot.company_search, 0),
            'people_search', coalesce(credits_pivot.people_search, 0),
            'email_enrich', coalesce(credits_pivot.email_enrich, 0),
            'mobile_enrich', coalesce(credits_pivot.mobile_enrich, 0)
          )
        )
        order by days.d
      )
      from days
      left join signups on signups.d = days.d
      left join revenue on revenue.d = days.d
      left join credits_pivot on credits_pivot.d = days.d
    ),
    '[]'::jsonb
  );
end;
$$;

-- ── System health (run status + provider aggregates; no raw result scan) ─

create or replace function fn_admin_system_health(p_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 180));
  v_since timestamptz := current_timestamp - make_interval(days => v_days);
  v_run_status jsonb;
  v_providers jsonb;
  v_trend jsonb;
  v_top text[];
begin
  select coalesce(
    jsonb_object_agg(status, cnt),
    '{}'::jsonb
  )
  into v_run_status
  from (
    select status, count(*)::int as cnt
    from enrichment_runs
    where created_at >= v_since
      and status in ('pending', 'running', 'completed', 'cancelled', 'failed')
    group by status
  ) s;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'provider', provider,
        'total', total,
        'error_rate', case when total > 0 then errors::float8 / total else 0 end,
        'avg_latency_ms', avg_latency_ms
      )
      order by total desc
    ),
    '[]'::jsonb
  )
  into v_providers
  from (
    select
      provider,
      count(*)::int as total,
      count(*) filter (where outcome = 'error')::int as errors,
      case
        when count(latency_ms) > 0 then round(avg(latency_ms))::int
        else null
      end as avg_latency_ms
    from enrichment_results
    where created_at >= v_since
    group by provider
  ) p;

  select coalesce(array_agg(provider), array[]::text[])
  into v_top
  from (
    select provider
    from enrichment_results
    where created_at >= v_since
    group by provider
    order by count(*) desc
    limit 4
  ) t;

  select coalesce(
    (
      with days as (
        select generate_series(
          (v_since at time zone 'utc')::date,
          (current_timestamp at time zone 'utc')::date,
          interval '1 day'
        )::date as d
      ),
      daily as (
        select
          (created_at at time zone 'utc')::date as d,
          provider,
          count(*)::int as total,
          count(*) filter (where outcome = 'error')::int as errors
        from enrichment_results
        where created_at >= v_since
          and provider = any (v_top)
        group by 1, 2
      )
      select jsonb_agg(
        jsonb_build_object(
          'date', to_char(days.d, 'YYYY-MM-DD'),
          'rates', coalesce(
            (
              select jsonb_object_agg(
                provider,
                case when total > 0 then errors::float8 / total else 0 end
              )
              from daily
              where daily.d = days.d
            ),
            '{}'::jsonb
          )
        )
        order by days.d
      )
      from days
    ),
    '[]'::jsonb
  )
  into v_trend;

  -- Fill missing top providers with 0 rates per day for stable chart keys.
  if cardinality(v_top) > 0 then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'date', e->>'date',
          'rates', (
            select jsonb_object_agg(p, coalesce((e->'rates'->>p)::float8, 0))
            from unnest(v_top) as p
          )
        )
        order by e->>'date'
      ),
      '[]'::jsonb
    )
    into v_trend
    from jsonb_array_elements(v_trend) e;
  end if;

  return jsonb_build_object(
    'run_status_counts', v_run_status,
    'providers', v_providers,
    'provider_error_trend', v_trend
  );
end;
$$;

-- ── Feature usage / use-case / top companies ────────────────────────────

create or replace function fn_admin_feature_usage(p_days integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with totals as (
    select
      run_type,
      coalesce(sum(credits_charged), 0)::bigint as credits
    from enrichment_runs
    where completed_at is not null
      and completed_at >= current_timestamp - make_interval(days => greatest(1, least(coalesce(p_days, 30), 180)))
      and run_type in ('company_search', 'people_search', 'email_enrich', 'mobile_enrich')
    group by run_type
  ),
  types as (
    select unnest(array['company_search', 'people_search', 'email_enrich', 'mobile_enrich']) as run_type
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'run_type', types.run_type,
        'credits', coalesce(totals.credits, 0)
      )
      order by types.run_type
    ),
    '[]'::jsonb
  )
  from types
  left join totals on totals.run_type = types.run_type;
$$;

create or replace function fn_admin_use_case_breakdown()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('use_case', use_case, 'count', cnt)
      order by cnt desc
    ),
    '[]'::jsonb
  )
  from (
    select coalesce(nullif(trim(use_case), ''), 'Not set') as use_case, count(*)::int as cnt
    from profiles
    group by 1
  ) s;
$$;

create or replace function fn_admin_top_companies(p_limit integer default 10)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with companies as (
    select
      p.company,
      count(*)::int as user_count,
      coalesce(sum(w.lifetime_purchased), 0)::bigint as lifetime_purchased,
      coalesce(sum(w.lifetime_consumed), 0)::bigint as lifetime_consumed
    from profiles p
    left join credit_wallets w on w.user_id = p.id
    where p.company is not null
      and trim(p.company) <> ''
    group by p.company
  ),
  revenue as (
    select
      p.company,
      coalesce(sum(pay.amount_minor_units), 0)::bigint as revenue_minor_units
    from payments pay
    join profiles p on p.id = pay.user_id
    where pay.status = 'success'
      and p.company is not null
      and trim(p.company) <> ''
    group by p.company
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'company', c.company,
        'user_count', c.user_count,
        'lifetime_purchased', c.lifetime_purchased,
        'lifetime_consumed', c.lifetime_consumed,
        'revenue_minor_units', coalesce(r.revenue_minor_units, 0)
      )
      order by c.lifetime_consumed desc
    ),
    '[]'::jsonb
  )
  from (
    select * from companies
    order by lifetime_consumed desc
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  ) c
  left join revenue r on r.company = c.company;
$$;

-- ── Subscription status rollup (MRR still priced in app code) ────────────

create or replace function fn_admin_subscription_status_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'plan_id', plan_id,
        'status', status,
        'count', cnt
      )
    ),
    '[]'::jsonb
  )
  from (
    select plan_id, status, count(*)::int as cnt
    from subscriptions
    group by plan_id, status
  ) s;
$$;

create or replace function fn_admin_lapsing_soon_count(p_days integer default 7)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::bigint
  from subscriptions
  where status = 'past_due'
     or (
       status = 'active'
       and current_period_end <= current_timestamp + make_interval(days => greatest(1, least(coalesce(p_days, 7), 30)))
     );
$$;

-- ── Invoice KPIs ────────────────────────────────────────────────────────

create or replace function fn_admin_invoices_kpis()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mtd timestamptz := date_trunc('month', current_timestamp at time zone 'utc') at time zone 'utc';
  v_result jsonb;
begin
  select jsonb_build_object(
    'tax_invoice_count_mtd', count(*) filter (
      where document_type = 'tax_invoice'
        and status not in ('cancelled', 'void')
        and issued_at >= v_mtd
    ),
    'tax_invoice_count_all', count(*) filter (
      where document_type = 'tax_invoice'
        and status not in ('cancelled', 'void')
    ),
    'taxable_minor_mtd', coalesce(sum(taxable_value_minor) filter (
      where document_type = 'tax_invoice'
        and status not in ('cancelled', 'void')
        and issued_at >= v_mtd
    ), 0),
    'cgst_minor_mtd', coalesce(sum(cgst_minor) filter (
      where document_type = 'tax_invoice'
        and status not in ('cancelled', 'void')
        and issued_at >= v_mtd
    ), 0),
    'sgst_minor_mtd', coalesce(sum(sgst_minor) filter (
      where document_type = 'tax_invoice'
        and status not in ('cancelled', 'void')
        and issued_at >= v_mtd
    ), 0),
    'igst_minor_mtd', coalesce(sum(igst_minor) filter (
      where document_type = 'tax_invoice'
        and status not in ('cancelled', 'void')
        and issued_at >= v_mtd
    ), 0),
    'total_minor_mtd', coalesce(sum(total_minor) filter (
      where document_type = 'tax_invoice'
        and status not in ('cancelled', 'void')
        and issued_at >= v_mtd
    ), 0),
    'taxable_minor_all', coalesce(sum(taxable_value_minor) filter (
      where document_type = 'tax_invoice'
        and status not in ('cancelled', 'void')
    ), 0),
    'gst_minor_all', coalesce(sum(cgst_minor + sgst_minor + igst_minor) filter (
      where document_type = 'tax_invoice'
        and status not in ('cancelled', 'void')
    ), 0),
    'total_minor_all', coalesce(sum(total_minor) filter (
      where document_type = 'tax_invoice'
        and status not in ('cancelled', 'void')
    ), 0),
    'open_proforma_count', count(*) filter (
      where document_type = 'proforma_invoice' and status = 'issued'
    ),
    'open_proforma_total_minor', coalesce(sum(total_minor) filter (
      where document_type = 'proforma_invoice' and status = 'issued'
    ), 0)
  )
  into v_result
  from invoices;

  v_result := v_result || jsonb_build_object(
    'gst_minor_mtd',
      (v_result->>'cgst_minor_mtd')::bigint
      + (v_result->>'sgst_minor_mtd')::bigint
      + (v_result->>'igst_minor_mtd')::bigint,
    'success_payments_without_tax_invoice',
    (
      select count(*)::bigint
      from payments pay
      where pay.status = 'success'
        and not exists (
          select 1
          from invoices inv
          where inv.payment_id = pay.id
            and inv.document_type = 'tax_invoice'
        )
    )
  );

  return v_result;
end;
$$;

revoke all on function fn_admin_distinct_run_users(timestamptz) from public;
revoke all on function fn_admin_distinct_paid_users() from public;
revoke all on function fn_admin_trends(integer) from public;
revoke all on function fn_admin_system_health(integer) from public;
revoke all on function fn_admin_feature_usage(integer) from public;
revoke all on function fn_admin_use_case_breakdown() from public;
revoke all on function fn_admin_top_companies(integer) from public;
revoke all on function fn_admin_subscription_status_counts() from public;
revoke all on function fn_admin_lapsing_soon_count(integer) from public;
revoke all on function fn_admin_invoices_kpis() from public;

grant execute on function fn_admin_distinct_run_users(timestamptz) to service_role;
grant execute on function fn_admin_distinct_paid_users() to service_role;
grant execute on function fn_admin_trends(integer) to service_role;
grant execute on function fn_admin_system_health(integer) to service_role;
grant execute on function fn_admin_feature_usage(integer) to service_role;
grant execute on function fn_admin_use_case_breakdown() to service_role;
grant execute on function fn_admin_top_companies(integer) to service_role;
grant execute on function fn_admin_subscription_status_counts() to service_role;
grant execute on function fn_admin_lapsing_soon_count(integer) to service_role;
grant execute on function fn_admin_invoices_kpis() to service_role;

-- Helpful indexes for the aggregate windows above.
create index if not exists payments_created_at_idx on payments (created_at);
create index if not exists payments_status_created_at_idx on payments (status, created_at);
create index if not exists enrichment_runs_created_at_idx on enrichment_runs (created_at);
create index if not exists enrichment_runs_completed_at_idx on enrichment_runs (completed_at);
create index if not exists enrichment_results_created_at_idx on enrichment_results (created_at);
create index if not exists enrichment_results_provider_created_at_idx on enrichment_results (provider, created_at);

commit;
