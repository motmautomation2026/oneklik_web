-- 0016_buffer_two_days.sql
-- Already applied 0013 with a 3-day post-due window.
-- Switch renew buffer to 2 days for new periods + shorten current open periods.
-- Column name stays grace_ends_at (internal); product language is "buffer".

begin;

create or replace function fn_complete_subscription_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments%rowtype;
  v_sub subscriptions%rowtype;
  v_existing_period_id uuid;
  v_other_renew uuid;
  v_available integer;
  v_rollover integer := 0;
  v_expired integer := 0;
  v_change_type text;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_grace_ends timestamptz;
  v_period_id uuid;
  v_plan_id text;
  v_credits integer;
  v_old_plan text;
  v_has_sub boolean;
begin
  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;

  if v_payment.status <> 'success' then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_success');
  end if;

  v_plan_id := coalesce(v_payment.pack_id, '');
  v_credits := v_payment.credits_promised;
  if v_plan_id = '' or v_credits is null or v_credits <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_pack');
  end if;

  -- Already applied to a period
  select id into v_existing_period_id
  from subscription_periods
  where payment_id = p_payment_id;

  if v_existing_period_id is not null then
    return jsonb_build_object(
      'ok', true,
      'already_applied', true,
      'period_id', v_existing_period_id
    );
  end if;

  -- Double renew for same renews_period_id: top-up only
  if v_payment.renews_period_id is not null then
    select id into v_other_renew
    from payments
    where renews_period_id = v_payment.renews_period_id
      and status = 'success'
      and id <> p_payment_id
    limit 1;

    if v_other_renew is not null then
      perform 1 from credit_wallets where user_id = v_payment.user_id for update;
      perform fn_grant_credits(
        v_payment.user_id, v_credits, 'purchase', p_payment_id, 'monthly_topup_duplicate_renew'
      );
      update payments
      set billing_intent = 'topup', updated_at = now()
      where id = p_payment_id;
      return jsonb_build_object('ok', true, 'topup', true, 'credits_granted', v_credits);
    end if;
  end if;

  select * into v_sub from subscriptions where user_id = v_payment.user_id for update;
  v_has_sub := found;

  perform 1 from credit_wallets where user_id = v_payment.user_id for update;
  select available_balance into v_available from credit_wallets where user_id = v_payment.user_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'wallet_not_found');
  end if;

  if not v_has_sub then
    -- First monthly purchase (initial). Keep leftover (legacy/promo).
    v_change_type := 'initial';
    v_rollover := coalesce(v_available, 0);
    v_period_start := fn_ist_day_start(now());
    -- Due date = start + 1 calendar month (IST). Buffer ends end-of-day +2 days.
    v_period_end := fn_add_one_month_ist(v_period_start);
    v_grace_ends := fn_ist_day_end(fn_add_days_ist(v_period_end, 2));

    perform fn_grant_credits(
      v_payment.user_id, v_credits, 'purchase', p_payment_id, 'monthly_initial'
    );

    insert into subscriptions (
      user_id, plan_id, status,
      current_period_start, current_period_end, grace_ends_at,
      pending_plan_id, last_payment_id
    ) values (
      v_payment.user_id, v_plan_id, 'active',
      v_period_start, v_period_end, v_grace_ends,
      v_plan_id, p_payment_id
    )
    returning * into v_sub;

    insert into subscription_periods (
      subscription_id, user_id, plan_id,
      period_start, period_end, grace_ends_at,
      credits_granted, rollover_credits, credits_expired,
      change_type, payment_id, renewal_applied_at
    ) values (
      v_sub.id, v_payment.user_id, v_plan_id,
      v_period_start, v_period_end, v_grace_ends,
      v_credits, v_rollover, 0,
      'initial', p_payment_id, now()
    )
    returning id into v_period_id;

    update subscriptions
    set current_period_id = v_period_id, updated_at = now()
    where id = v_sub.id;

    update payments
    set billing_intent = 'initial', updated_at = now()
    where id = p_payment_id;

    return jsonb_build_object(
      'ok', true,
      'change_type', 'initial',
      'period_id', v_period_id,
      'credits_granted', v_credits,
      'rollover_credits', v_rollover
    );
  end if;

  -- Existing subscription
  v_old_plan := v_sub.plan_id;

  if v_sub.status = 'expired' or v_sub.grace_ends_at < now() then
    -- Lapsed: no rollover
    v_expired := coalesce(v_available, 0);
    if v_expired > 0 then
      perform fn_expire_credits(
        v_payment.user_id, v_expired, coalesce(v_sub.current_period_id, p_payment_id), 'subscription_lapsed_before_renew'
      );
    end if;
    v_change_type := 'initial'; -- rejoin after lapse
    v_rollover := 0;
    v_period_start := fn_ist_day_start(now());
  elsif now() <= v_sub.current_period_end then
    -- Early renew: next period starts at current period_end
    if fn_plan_rank(v_plan_id) < fn_plan_rank(v_old_plan) then
      v_expired := coalesce(v_available, 0);
      if v_expired > 0 then
        perform fn_expire_credits(
          v_payment.user_id, v_expired, coalesce(v_sub.current_period_id, p_payment_id), 'subscription_downgrade'
        );
      end if;
      v_change_type := 'downgrade';
      v_rollover := 0;
    elsif fn_plan_rank(v_plan_id) > fn_plan_rank(v_old_plan) then
      v_change_type := 'upgrade';
      v_rollover := coalesce(v_available, 0);
    else
      v_change_type := 'renew_same';
      v_rollover := coalesce(v_available, 0);
    end if;
    v_period_start := v_sub.current_period_end;
  else
    -- In buffer
    if fn_plan_rank(v_plan_id) < fn_plan_rank(v_old_plan) then
      v_expired := coalesce(v_available, 0);
      if v_expired > 0 then
        perform fn_expire_credits(
          v_payment.user_id, v_expired, coalesce(v_sub.current_period_id, p_payment_id), 'subscription_downgrade'
        );
      end if;
      v_change_type := 'downgrade';
      v_rollover := 0;
    elsif fn_plan_rank(v_plan_id) > fn_plan_rank(v_old_plan) then
      v_change_type := 'upgrade';
      v_rollover := coalesce(v_available, 0);
    else
      v_change_type := 'renew_same';
      v_rollover := coalesce(v_available, 0);
    end if;
    v_period_start := fn_ist_day_start(now());
  end if;

  -- Re-read available after possible expiry for accurate rollover recording
  select available_balance into v_available from credit_wallets where user_id = v_payment.user_id;
  if v_change_type in ('renew_same', 'upgrade') then
    v_rollover := coalesce(v_available, 0);
  end if;

  v_period_end := fn_add_one_month_ist(v_period_start);
  -- Buffer ends end-of-day +2 days after period end.
  v_grace_ends := fn_ist_day_end(fn_add_days_ist(v_period_end, 2));

  perform fn_grant_credits(
    v_payment.user_id, v_credits, 'purchase', p_payment_id, 'monthly_' || v_change_type
  );

  insert into subscription_periods (
    subscription_id, user_id, plan_id,
    period_start, period_end, grace_ends_at,
    credits_granted, rollover_credits, credits_expired,
    change_type, payment_id, renewal_applied_at
  ) values (
    v_sub.id, v_payment.user_id, v_plan_id,
    v_period_start, v_period_end, v_grace_ends,
    v_credits, v_rollover, v_expired,
    v_change_type, p_payment_id, now()
  )
  returning id into v_period_id;

  update subscriptions
  set plan_id = v_plan_id,
      status = 'active',
      current_period_id = v_period_id,
      current_period_start = v_period_start,
      current_period_end = v_period_end,
      grace_ends_at = v_grace_ends,
      pending_plan_id = v_plan_id,
      last_payment_id = p_payment_id,
      updated_at = now()
  where id = v_sub.id;

  update payments
  set billing_intent = case when v_change_type = 'initial' then 'initial' else 'renew' end,
      updated_at = now()
  where id = p_payment_id;

  return jsonb_build_object(
    'ok', true,
    'change_type', v_change_type,
    'period_id', v_period_id,
    'credits_granted', v_credits,
    'rollover_credits', v_rollover,
    'credits_expired', v_expired
  );
end;
$$;

revoke all on function fn_complete_subscription_payment(uuid) from public;
grant execute on function fn_complete_subscription_payment(uuid) to service_role;

-- Shorten buffer on current open subscriptions (were calculated with +3).
update subscriptions
set grace_ends_at = fn_ist_day_end(fn_add_days_ist(current_period_end, 2)),
    updated_at = now()
where status in ('active', 'past_due');

update subscription_periods sp
set grace_ends_at = fn_ist_day_end(fn_add_days_ist(sp.period_end, 2)),
    updated_at = now()
from subscriptions s
where sp.id = s.current_period_id
  and s.status in ('active', 'past_due');

commit;
