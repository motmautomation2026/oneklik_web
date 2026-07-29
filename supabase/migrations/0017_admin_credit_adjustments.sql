-- 0017_admin_credit_adjustments.sql
-- Admin goodwill / compensation grants. Writes admin_adjustment ledger rows
-- (reserved since 0001) via a dedicated SECURITY DEFINER RPC. Grant-only:
-- amount must be positive. Does not bump lifetime_purchased.
--
-- Idempotent on reference_id so a retried API call cannot double-grant.
-- Free-text reason + acted_by live in admin_credit_adjustments (audit), not
-- on the ledger row (which only stores reason_code).

begin;

-- ── Idempotency for admin_adjustment grants ─────────────────────────────

create unique index if not exists credit_ledger_admin_adjustment_idempotent_idx
  on credit_ledger (reference_id)
  where type = 'admin_adjustment'
    and reference_id is not null;

-- ── fn_admin_adjust_credits ─────────────────────────────────────────────
-- The only path that writes type = 'admin_adjustment'. Callers must pass a
-- unique reference_id per intended grant. A replay with the same reference
-- returns the current balance without mutating again.

create or replace function fn_admin_adjust_credits(
  p_user_id uuid,
  p_amount integer,
  p_reference_id uuid,
  p_reason_code text default 'admin_grant'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available integer;
  v_already boolean;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'admin adjustment amount must be positive';
  end if;

  if p_reference_id is null then
    raise exception 'admin adjustment reference_id is required';
  end if;

  if p_reason_code is null or length(trim(p_reason_code)) = 0 then
    raise exception 'admin adjustment reason_code is required';
  end if;

  select exists(
    select 1 from credit_ledger
    where type = 'admin_adjustment' and reference_id = p_reference_id
  ) into v_already;

  if v_already then
    select available_balance into v_available
    from credit_wallets
    where user_id = p_user_id;
    if not found then
      raise exception 'wallet not found for user %', p_user_id;
    end if;
    return v_available;
  end if;

  select available_balance into v_available
  from credit_wallets
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'wallet not found for user %', p_user_id;
  end if;

  update credit_wallets
  set available_balance = available_balance + p_amount
  where user_id = p_user_id
  returning available_balance into v_available;

  insert into credit_ledger (user_id, type, amount, reference_id, reason_code, balance_after)
  values (p_user_id, 'admin_adjustment', p_amount, p_reference_id, trim(p_reason_code), v_available);

  return v_available;
end;
$$;

revoke all on function fn_admin_adjust_credits(uuid, integer, uuid, text) from public;
grant execute on function fn_admin_adjust_credits(uuid, integer, uuid, text) to service_role;

-- ── admin_credit_adjustments (append-only audit log) ────────────────────
-- Mirrors moderation_actions: admins may read/insert; no update/delete
-- policies (RLS default-denies). Backend writes via service role.

create table if not exists admin_credit_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  amount integer not null check (amount > 0),
  reason text not null,
  reason_code text not null default 'admin_grant',
  reference_id uuid not null unique,
  balance_after integer not null,
  acted_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists admin_credit_adjustments_user_id_idx
  on admin_credit_adjustments (user_id);

create index if not exists admin_credit_adjustments_acted_by_idx
  on admin_credit_adjustments (acted_by);

alter table admin_credit_adjustments enable row level security;

create policy admin_credit_adjustments_admin_select on admin_credit_adjustments
  for select using (is_admin());

create policy admin_credit_adjustments_admin_insert on admin_credit_adjustments
  for insert with check (is_admin());

commit;
