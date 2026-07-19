-- 0002_credit_ledger_functions.sql
-- Week 1, Days 3-4: the only functions ever allowed to mutate credit_wallets
-- or write to credit_ledger. All four are SECURITY DEFINER (they run as the
-- table owner, so they can write past the read-only RLS policies on
-- credit_wallets/credit_ledger) and EXECUTE is revoked from PUBLIC/authenticated
-- immediately after creation — only the backend's service-role client may call
-- them. A regular user has no path to invoke these directly.
--
-- Lock ordering is consistent everywhere (enrichment_runs row, then
-- credit_wallets row) to avoid deadlocks between concurrent calls.

-- ── fn_hold_credits ─────────────────────────────────────────────────────
-- Called once, at run creation. Atomically moves `p_amount` credits from
-- available to held, and flips the run from 'pending' to 'running'. Fails
-- cleanly (transaction rolls back) if the run was already started or the
-- wallet can't cover the amount — so a run is never left half-held.

create or replace function fn_hold_credits(
  p_user_id uuid,
  p_run_id uuid,
  p_amount integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_available integer;
begin
  if p_amount <= 0 then
    raise exception 'hold amount must be positive';
  end if;

  select status into v_status
  from enrichment_runs
  where id = p_run_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'run % not found for user %', p_run_id, p_user_id;
  end if;

  if v_status <> 'pending' then
    raise exception 'run % is not pending (status=%), refusing to hold twice', p_run_id, v_status;
  end if;

  select available_balance into v_available
  from credit_wallets
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'wallet not found for user %', p_user_id;
  end if;

  if v_available < p_amount then
    raise exception 'insufficient_credits: available % requested %', v_available, p_amount;
  end if;

  update credit_wallets
  set available_balance = available_balance - p_amount,
      held_balance = held_balance + p_amount
  where user_id = p_user_id
  returning available_balance into v_available;

  insert into credit_ledger (user_id, type, amount, reference_id, reason_code, balance_after)
  values (p_user_id, 'hold', p_amount, p_run_id, 'run_hold', v_available);

  update enrichment_runs
  set status = 'running', credits_held = p_amount
  where id = p_run_id;

  return v_available;
end;
$$;

revoke execute on function fn_hold_credits(uuid, uuid, integer) from public;

-- ── fn_resolve_row ──────────────────────────────────────────────────────
-- Called once per row after a worker has already written its outcome to
-- enrichment_results. 'found' converts held credits into a permanent
-- deduction; 'not_found'/'error' releases the hold back to available.
-- When every requested row has a result, the run auto-completes.

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
    update credit_wallets
    set held_balance = held_balance - p_credits,
        available_balance = available_balance + p_credits
    where user_id = v_user_id
    returning available_balance into v_available;

    insert into credit_ledger (user_id, type, amount, reference_id, row_reference, reason_code, balance_after)
    values (v_user_id, 'release', p_credits, p_run_id, p_list_item_id, 'reveal_' || p_outcome, v_available);

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

-- ── fn_release_remaining ────────────────────────────────────────────────
-- For cancellations: releases whatever portion of the original hold hasn't
-- yet been charged or released row-by-row, and closes the run. Idempotent —
-- calling it twice on an already-finalized run raises instead of double-releasing.

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

    update credit_wallets
    set held_balance = held_balance - v_remaining,
        available_balance = available_balance + v_remaining
    where user_id = v_user_id
    returning available_balance into v_available;

    insert into credit_ledger (user_id, type, amount, reference_id, reason_code, balance_after)
    values (v_user_id, 'release', v_remaining, p_run_id, 'run_cancelled', v_available);

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

-- ── fn_grant_credits ────────────────────────────────────────────────────
-- The only way available_balance is ever increased outside a release.
-- Covers both the purchase path (webhook-driven, p_type='purchase') and the
-- one-time free-tier grant (p_type='promo_grant'). Both are idempotent on
-- their reference: a repeated call for the same payment, or a second
-- promo_grant for the same user, is a no-op rather than a double credit —
-- this is what makes a replayed payment webhook safe.

create or replace function fn_grant_credits(
  p_user_id uuid,
  p_amount integer,
  p_type text,
  p_reference_id uuid,
  p_reason_code text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available integer;
  v_already_granted boolean;
begin
  if p_type not in ('purchase', 'promo_grant') then
    raise exception 'fn_grant_credits only supports purchase or promo_grant, got %', p_type;
  end if;

  if p_amount <= 0 then
    raise exception 'grant amount must be positive';
  end if;

  if p_type = 'purchase' then
    select exists(
      select 1 from credit_ledger
      where type = 'purchase' and reference_id = p_reference_id
    ) into v_already_granted;
  else
    select exists(
      select 1 from credit_ledger
      where type = 'promo_grant' and user_id = p_user_id
    ) into v_already_granted;
  end if;

  if v_already_granted then
    select available_balance into v_available from credit_wallets where user_id = p_user_id;
    return v_available;
  end if;

  update credit_wallets
  set available_balance = available_balance + p_amount,
      lifetime_purchased = lifetime_purchased + case when p_type = 'purchase' then p_amount else 0 end
  where user_id = p_user_id
  returning available_balance into v_available;

  if not found then
    raise exception 'wallet not found for user %', p_user_id;
  end if;

  insert into credit_ledger (user_id, type, amount, reference_id, reason_code, balance_after)
  values (p_user_id, p_type, p_amount, p_reference_id, p_reason_code, v_available);

  return v_available;
end;
$$;

revoke execute on function fn_grant_credits(uuid, integer, text, uuid, text) from public;
