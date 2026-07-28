-- 0013_monthly_billing.sql
-- Monthly plans on top of existing Razorpay Orders + tax invoices.
-- Additive: legacy wallets without a subscriptions row are untouched.
-- ALL OR NOTHING — mid-migration failure must not leave half the schema.

begin;

-- ── credit_ledger: allow expiry entries ─────────────────────────────────

alter table credit_ledger
  drop constraint if exists credit_ledger_type_check;

alter table credit_ledger
  add constraint credit_ledger_type_check
  check (type in (
    'hold', 'deduct', 'release', 'purchase', 'promo_grant', 'admin_adjustment', 'expiry'
  ));

-- Idempotent subscription expiries only (release-after-expiry rows may share a run id).
create unique index if not exists credit_ledger_expiry_idempotent_idx
  on credit_ledger (reference_id, reason_code)
  where type = 'expiry'
    and reference_id is not null
    and reason_code in (
      'subscription_grace_ended',
      'subscription_lapsed_before_renew',
      'subscription_downgrade'
    );

-- ── payments: billing intent columns ────────────────────────────────────

alter table payments
  add column if not exists renews_period_id uuid,
  add column if not exists billing_intent text
    check (billing_intent is null or billing_intent in ('initial', 'renew', 'topup'));

-- At most one successful renew payment per period being renewed.
create unique index if not exists payments_renews_period_success_idx
  on payments (renews_period_id)
  where renews_period_id is not null and status = 'success';

create index if not exists payments_pending_renew_idx
  on payments (user_id, renews_period_id, status)
  where renews_period_id is not null and status in ('initiated', 'pending');

-- ── subscriptions ───────────────────────────────────────────────────────

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles(id) on delete cascade,
  plan_id text not null,
  status text not null default 'active'
    check (status in ('active', 'past_due', 'expired', 'cancelled')),
  current_period_id uuid,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  grace_ends_at timestamptz not null,
  pending_plan_id text,
  last_payment_id uuid references payments(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_period_order check (current_period_end >= current_period_start),
  constraint subscriptions_grace_after_end check (grace_ends_at >= current_period_end)
);

create trigger subscriptions_set_updated_at
  before update on subscriptions
  for each row execute function set_updated_at();

create index if not exists subscriptions_status_grace_idx
  on subscriptions (status, grace_ends_at);

create index if not exists subscriptions_period_end_idx
  on subscriptions (current_period_end)
  where status in ('active', 'past_due');

alter table subscriptions enable row level security;

create policy subscriptions_select_own on subscriptions
  for select using (user_id = auth.uid() or is_admin());

-- ── subscription_periods ────────────────────────────────────────────────

create table if not exists subscription_periods (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  plan_id text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  grace_ends_at timestamptz not null,
  credits_granted integer not null default 0 check (credits_granted >= 0),
  rollover_credits integer not null default 0 check (rollover_credits >= 0),
  credits_expired integer not null default 0 check (credits_expired >= 0),
  change_type text not null
    check (change_type in ('initial', 'renew_same', 'upgrade', 'downgrade', 'expired', 'topup')),
  payment_id uuid unique references payments(id),
  proforma_id uuid,
  renewal_applied_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_periods_order check (period_end >= period_start),
  constraint subscription_periods_grace check (grace_ends_at >= period_end)
);

create trigger subscription_periods_set_updated_at
  before update on subscription_periods
  for each row execute function set_updated_at();

create index if not exists subscription_periods_user_id_idx
  on subscription_periods (user_id, period_end desc);

create index if not exists subscription_periods_subscription_id_idx
  on subscription_periods (subscription_id, period_start desc);

alter table subscription_periods enable row level security;

create policy subscription_periods_select_own on subscription_periods
  for select using (user_id = auth.uid() or is_admin());

-- FK from subscriptions.current_period_id (deferred until periods exist)
alter table subscriptions
  drop constraint if exists subscriptions_current_period_id_fkey;

alter table subscriptions
  add constraint subscriptions_current_period_id_fkey
  foreign key (current_period_id) references subscription_periods(id);

alter table payments
  drop constraint if exists payments_renews_period_id_fkey;

alter table payments
  add constraint payments_renews_period_id_fkey
  foreign key (renews_period_id) references subscription_periods(id);

-- ── invoices: pro forma support without breaking tax invoices ───────────

alter table invoices
  alter column payment_id drop not null;

alter table invoices
  alter column receipt_number drop not null;

alter table invoices
  drop constraint if exists invoices_payment_id_key;

alter table invoices
  drop constraint if exists invoices_document_type_check;

alter table invoices
  add constraint invoices_document_type_check
  check (document_type in ('tax_invoice', 'credit_note', 'proforma_invoice'));

alter table invoices
  drop constraint if exists invoices_status_check;

alter table invoices
  add constraint invoices_status_check
  check (status in ('issued', 'cancelled', 'paid', 'void'));

alter table invoices
  drop constraint if exists invoices_doc_payment_receipt_ck;

alter table invoices
  add constraint invoices_doc_payment_receipt_ck check (
    (document_type = 'tax_invoice' and payment_id is not null and receipt_number is not null)
    or (document_type = 'credit_note' and payment_id is not null and receipt_number is not null)
    or (document_type = 'proforma_invoice' and payment_id is null and receipt_number is null)
  );

create unique index if not exists invoices_payment_id_tax_unique_idx
  on invoices (payment_id)
  where payment_id is not null;

create unique index if not exists invoices_receipt_number_unique_idx
  on invoices (receipt_number)
  where receipt_number is not null;

alter table invoices
  add column if not exists due_date date,
  add column if not exists related_tax_invoice_id uuid references invoices(id),
  add column if not exists subscription_period_id uuid references subscription_periods(id);

create index if not exists invoices_document_type_idx
  on invoices (user_id, document_type, issued_at desc);

alter table subscription_periods
  drop constraint if exists subscription_periods_proforma_id_fkey;

alter table subscription_periods
  add constraint subscription_periods_proforma_id_fkey
  foreign key (proforma_id) references invoices(id);

-- ── plan rank helper ────────────────────────────────────────────────────

create or replace function fn_plan_rank(p_plan_id text)
returns integer
language sql
immutable
as $$
  select case p_plan_id
    when 'starter' then 1
    when 'growth' then 2
    when 'business' then 3
    else 0
  end;
$$;

-- IST calendar helpers for period boundaries
create or replace function fn_ist_day_start(p_ts timestamptz)
returns timestamptz
language sql
stable
as $$
  select ((p_ts at time zone 'Asia/Kolkata')::date)::timestamp
    at time zone 'Asia/Kolkata';
$$;

create or replace function fn_add_one_month_ist(p_ts timestamptz)
returns timestamptz
language sql
stable
as $$
  select fn_ist_day_start(
    ((p_ts at time zone 'Asia/Kolkata')::date + interval '1 month')::timestamp
      at time zone 'Asia/Kolkata'
  );
$$;

create or replace function fn_add_days_ist(p_ts timestamptz, p_days integer)
returns timestamptz
language sql
stable
as $$
  select fn_ist_day_start(
    ((p_ts at time zone 'Asia/Kolkata')::date + (p_days || ' days')::interval)::timestamp
      at time zone 'Asia/Kolkata'
  );
$$;

-- End of IST calendar day for a timestamptz's IST date
create or replace function fn_ist_day_end(p_ts timestamptz)
returns timestamptz
language sql
stable
as $$
  select (
    ((p_ts at time zone 'Asia/Kolkata')::date + interval '1 day')::timestamp
      at time zone 'Asia/Kolkata'
  ) - interval '1 microsecond';
$$;

-- ── fn_expire_credits ───────────────────────────────────────────────────

create or replace function fn_expire_credits(
  p_user_id uuid,
  p_amount integer,
  p_reference_id uuid,
  p_reason_code text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available integer;
  v_to_expire integer;
  v_existing boolean;
begin
  if p_amount < 0 then
    raise exception 'expire amount must be >= 0';
  end if;

  if p_amount = 0 then
    select available_balance into v_available from credit_wallets where user_id = p_user_id;
    return coalesce(v_available, 0);
  end if;

  select exists(
    select 1 from credit_ledger
    where type = 'expiry'
      and reference_id = p_reference_id
      and reason_code = p_reason_code
  ) into v_existing;

  if v_existing then
    select available_balance into v_available from credit_wallets where user_id = p_user_id;
    return coalesce(v_available, 0);
  end if;

  select available_balance into v_available
  from credit_wallets
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'wallet not found for user %', p_user_id;
  end if;

  v_to_expire := least(v_available, p_amount);
  if v_to_expire <= 0 then
    insert into credit_ledger (user_id, type, amount, reference_id, reason_code, balance_after)
    values (p_user_id, 'expiry', 0, p_reference_id, p_reason_code, v_available);
    return v_available;
  end if;

  update credit_wallets
  set available_balance = available_balance - v_to_expire
  where user_id = p_user_id
  returning available_balance into v_available;

  insert into credit_ledger (user_id, type, amount, reference_id, reason_code, balance_after)
  values (p_user_id, 'expiry', v_to_expire, p_reference_id, p_reason_code, v_available);

  return v_available;
end;
$$;

revoke all on function fn_expire_credits(uuid, integer, uuid, text) from public;
grant execute on function fn_expire_credits(uuid, integer, uuid, text) to service_role;

-- ── subscription past grace? (for release-path guards) ──────────────────

create or replace function fn_subscription_blocks_release(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
  v_grace timestamptz;
begin
  select status, grace_ends_at into v_status, v_grace
  from subscriptions
  where user_id = p_user_id;

  if not found then
    return false; -- legacy one-time wallet
  end if;

  if v_status = 'expired' then
    return true;
  end if;

  if v_status in ('active', 'past_due', 'cancelled') and v_grace < now() then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function fn_subscription_blocks_release(uuid) from public;
grant execute on function fn_subscription_blocks_release(uuid) to service_role;

-- ── patch fn_resolve_row: expire releases when subscription lapsed ──────

create or replace function fn_resolve_row(
  p_run_id uuid,
  p_list_item_id uuid,
  p_outcome text,
  p_credits integer default 1
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_requested integer;
  v_available integer;
  v_resolved_count integer;
  v_block_release boolean;
begin
  if p_outcome not in ('found', 'not_found', 'error') then
    raise exception 'invalid outcome %', p_outcome;
  end if;

  select user_id, requested_count into v_user_id, v_requested
  from enrichment_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'run % not found', p_run_id;
  end if;

  perform 1 from credit_wallets where user_id = v_user_id for update;
  if not found then
    raise exception 'wallet not found for user %', v_user_id;
  end if;

  if p_outcome = 'found' then
    update credit_wallets
    set held_balance = held_balance - p_credits,
        lifetime_consumed = lifetime_consumed + p_credits
    where user_id = v_user_id
    returning available_balance into v_available;

    insert into credit_ledger (user_id, type, amount, reference_id, row_reference, reason_code, balance_after)
    values (v_user_id, 'deduct', p_credits, p_run_id, p_list_item_id, 'reveal_found', v_available);

    update enrichment_runs
    set delivered_count = delivered_count + 1,
        credits_charged = credits_charged + p_credits
    where id = p_run_id;
  else
    v_block_release := fn_subscription_blocks_release(v_user_id);

    if v_block_release then
      update credit_wallets
      set held_balance = held_balance - p_credits
      where user_id = v_user_id
      returning available_balance into v_available;

      insert into credit_ledger (user_id, type, amount, reference_id, row_reference, reason_code, balance_after)
      values (v_user_id, 'expiry', p_credits, p_run_id, p_list_item_id, 'release_after_expiry', v_available);
    else
      update credit_wallets
      set held_balance = held_balance - p_credits,
          available_balance = available_balance + p_credits
      where user_id = v_user_id
      returning available_balance into v_available;

      insert into credit_ledger (user_id, type, amount, reference_id, row_reference, reason_code, balance_after)
      values (v_user_id, 'release', p_credits, p_run_id, p_list_item_id, 'reveal_' || p_outcome, v_available);
    end if;

    update enrichment_runs
    set credits_released = credits_released + p_credits
    where id = p_run_id;
  end if;

  select count(*) into v_resolved_count
  from enrichment_results
  where run_id = p_run_id;

  if v_resolved_count >= v_requested then
    update enrichment_runs
    set status = 'completed', completed_at = now()
    where id = p_run_id;
  end if;
end;
$$;

revoke execute on function fn_resolve_row(uuid, uuid, text, integer) from public;
grant execute on function fn_resolve_row(uuid, uuid, text, integer) to service_role;

-- ── patch fn_release_remaining ──────────────────────────────────────────

create or replace function fn_release_remaining(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_status text;
  v_credits_held integer;
  v_credits_charged integer;
  v_credits_released integer;
  v_remaining integer;
  v_available integer;
  v_block_release boolean;
begin
  select user_id, status, credits_held, credits_charged, credits_released
  into v_user_id, v_status, v_credits_held, v_credits_charged, v_credits_released
  from enrichment_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'run % not found', p_run_id;
  end if;

  if v_status in ('completed', 'cancelled') then
    raise exception 'run % already finalized (status=%)', p_run_id, v_status;
  end if;

  v_remaining := v_credits_held - v_credits_charged - v_credits_released;

  if v_remaining > 0 then
    perform 1 from credit_wallets where user_id = v_user_id for update;
    v_block_release := fn_subscription_blocks_release(v_user_id);

    if v_block_release then
      update credit_wallets
      set held_balance = held_balance - v_remaining
      where user_id = v_user_id
      returning available_balance into v_available;

      insert into credit_ledger (user_id, type, amount, reference_id, reason_code, balance_after)
      values (v_user_id, 'expiry', v_remaining, p_run_id, 'release_remaining_after_expiry', v_available);
    else
      update credit_wallets
      set held_balance = held_balance - v_remaining,
          available_balance = available_balance + v_remaining
      where user_id = v_user_id
      returning available_balance into v_available;

      insert into credit_ledger (user_id, type, amount, reference_id, reason_code, balance_after)
      values (v_user_id, 'release', v_remaining, p_run_id, 'run_cancelled', v_available);
    end if;

    update enrichment_runs
    set credits_released = credits_released + v_remaining
    where id = p_run_id;
  end if;

  update enrichment_runs
  set status = 'cancelled', completed_at = now()
  where id = p_run_id;
end;
$$;

revoke execute on function fn_release_remaining(uuid) from public;
grant execute on function fn_release_remaining(uuid) to service_role;

-- ── fn_expire_subscription_period ───────────────────────────────────────

create or replace function fn_expire_subscription_period(p_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period subscription_periods%rowtype;
  v_sub subscriptions%rowtype;
  v_available integer;
  v_expired integer;
begin
  select * into v_period from subscription_periods where id = p_period_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'period_not_found');
  end if;

  if v_period.expired_at is not null then
    return jsonb_build_object('ok', true, 'already_expired', true, 'credits_expired', v_period.credits_expired);
  end if;

  select * into v_sub from subscriptions where id = v_period.subscription_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'subscription_not_found');
  end if;

  -- Only expire the user's current period after grace.
  if v_sub.current_period_id is distinct from p_period_id then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_current_period');
  end if;

  if v_sub.grace_ends_at >= now() then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'still_in_grace');
  end if;

  select available_balance into v_available
  from credit_wallets where user_id = v_period.user_id for update;

  v_expired := coalesce(v_available, 0);
  perform fn_expire_credits(v_period.user_id, v_expired, p_period_id, 'subscription_grace_ended');

  update subscription_periods
  set credits_expired = v_expired,
      expired_at = now(),
      change_type = case when change_type = 'expired' then change_type else change_type end,
      updated_at = now()
  where id = p_period_id;

  update subscriptions
  set status = 'expired',
      updated_at = now()
  where id = v_sub.id;

  return jsonb_build_object('ok', true, 'credits_expired', v_expired);
end;
$$;

revoke all on function fn_expire_subscription_period(uuid) from public;
grant execute on function fn_expire_subscription_period(uuid) to service_role;

-- ── fn_complete_subscription_payment ────────────────────────────────────
-- Single TX: expire if needed, grant purchase credits, advance subscription.

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
    -- Due date = start + 1 calendar month (IST). Grace ends end-of-day +3 days.
    v_period_end := fn_add_one_month_ist(v_period_start);
    v_grace_ends := fn_ist_day_end(fn_add_days_ist(v_period_end, 3));

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
    -- In grace
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
  v_grace_ends := fn_ist_day_end(fn_add_days_ist(v_period_end, 3));

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

-- ── fn_issue_proforma ───────────────────────────────────────────────────

create or replace function fn_issue_proforma(
  p_user_id uuid,
  p_subscription_period_id uuid,
  p_financial_year text,
  p_series text,
  p_fy_label text,
  p_invoice_date date,
  p_due_date date,
  p_seller_snapshot jsonb,
  p_buyer_snapshot jsonb,
  p_line_items jsonb,
  p_taxable_value_minor bigint,
  p_cgst_minor bigint,
  p_sgst_minor bigint,
  p_igst_minor bigint,
  p_total_minor bigint,
  p_tax_rate_bps integer,
  p_place_of_supply_state_code text,
  p_place_of_supply_state_name text,
  p_supply_type text,
  p_amount_in_words text,
  p_currency text default 'INR',
  p_template_version integer default 1
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_number integer;
  v_invoice_number text;
  v_id uuid;
begin
  select proforma_id into v_existing
  from subscription_periods
  where id = p_subscription_period_id;

  if v_existing is not null then
    return v_existing;
  end if;

  select id into v_existing
  from invoices
  where subscription_period_id = p_subscription_period_id
    and document_type = 'proforma_invoice'
  limit 1;

  if v_existing is not null then
    update subscription_periods set proforma_id = v_existing where id = p_subscription_period_id and proforma_id is null;
    return v_existing;
  end if;

  v_number := fn_next_invoice_number(p_financial_year, p_series);
  v_invoice_number := p_series || '-' || p_fy_label || '-' || lpad(v_number::text, 6, '0');

  insert into invoices (
    user_id,
    payment_id,
    invoice_number,
    receipt_number,
    financial_year,
    series,
    invoice_date,
    due_date,
    document_type,
    status,
    seller_snapshot,
    buyer_snapshot,
    line_items,
    payment_snapshot,
    taxable_value_minor,
    cgst_minor,
    sgst_minor,
    igst_minor,
    total_minor,
    tax_rate_bps,
    place_of_supply_state_code,
    place_of_supply_state_name,
    supply_type,
    amount_in_words,
    currency,
    template_version,
    subscription_period_id
  ) values (
    p_user_id,
    null,
    v_invoice_number,
    null,
    p_financial_year,
    p_series,
    p_invoice_date,
    p_due_date,
    'proforma_invoice',
    'issued',
    p_seller_snapshot,
    p_buyer_snapshot,
    p_line_items,
    '{}'::jsonb,
    p_taxable_value_minor,
    p_cgst_minor,
    p_sgst_minor,
    p_igst_minor,
    p_total_minor,
    p_tax_rate_bps,
    p_place_of_supply_state_code,
    p_place_of_supply_state_name,
    p_supply_type,
    p_amount_in_words,
    p_currency,
    p_template_version,
    p_subscription_period_id
  )
  returning id into v_id;

  update subscription_periods
  set proforma_id = v_id, updated_at = now()
  where id = p_subscription_period_id;

  return v_id;
exception
  when unique_violation then
    select id into v_existing
    from invoices
    where subscription_period_id = p_subscription_period_id
      and document_type = 'proforma_invoice'
    limit 1;
    if v_existing is null then
      raise;
    end if;
    return v_existing;
end;
$$;

revoke all on function fn_issue_proforma(
  uuid, uuid, text, text, text, date, date, jsonb, jsonb, jsonb,
  bigint, bigint, bigint, bigint, bigint, integer, text, text, text, text, text, integer
) from public;
grant execute on function fn_issue_proforma(
  uuid, uuid, text, text, text, date, date, jsonb, jsonb, jsonb,
  bigint, bigint, bigint, bigint, bigint, integer, text, text, text, text, text, integer
) to service_role;

-- Mark past_due when period ended but still in grace
create or replace function fn_mark_subscription_past_due(p_subscription_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub subscriptions%rowtype;
begin
  select * into v_sub from subscriptions where id = p_subscription_id for update;
  if not found then
    return false;
  end if;
  if v_sub.status <> 'active' then
    return false;
  end if;
  if now() <= v_sub.current_period_end then
    return false;
  end if;
  if now() > v_sub.grace_ends_at then
    return false;
  end if;
  update subscriptions set status = 'past_due', updated_at = now() where id = p_subscription_id;
  return true;
end;
$$;

revoke all on function fn_mark_subscription_past_due(uuid) from public;
grant execute on function fn_mark_subscription_past_due(uuid) to service_role;

revoke all on function fn_grant_credits(uuid, integer, text, uuid, text) from public;
grant execute on function fn_grant_credits(uuid, integer, text, uuid, text) to service_role;

-- Ensure grant is callable from fn_complete_subscription_payment (same owner).
-- No extra grants needed for SECURITY DEFINER → SECURITY DEFINER.

commit;
