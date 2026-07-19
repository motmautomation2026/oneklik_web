-- 0004_company_search_resolve.sql
-- Company Search charges a flat tier based on how many companies were
-- actually delivered (ceil(delivered / 25) credits), not per-row like email
-- reveal. fn_hold_credits (from 0002) already covers the hold step — this
-- adds the matching "whole-run" resolve step: charge the delivered tier,
-- release whatever of the hold wasn't used, in one atomic wallet mutation.

create or replace function fn_resolve_run(
  p_run_id uuid,
  p_outcome text,
  p_delivered_count integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_status text;
  v_credits_held integer;
  v_delivered_credits integer;
  v_released_credits integer;
  v_available integer;
begin
  if p_outcome not in ('completed', 'failed') then
    raise exception 'invalid outcome %, expected completed or failed', p_outcome;
  end if;

  select user_id, status, credits_held
  into v_user_id, v_status, v_credits_held
  from enrichment_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'run % not found', p_run_id;
  end if;

  if v_status <> 'running' then
    raise exception 'run % is not running (status=%), refusing to resolve twice', p_run_id, v_status;
  end if;

  -- ceil(delivered / 25) credits, never more than what was actually held.
  v_delivered_credits := least(ceil(greatest(p_delivered_count, 0)::numeric / 25)::integer, v_credits_held);
  v_released_credits := v_credits_held - v_delivered_credits;

  perform 1 from credit_wallets where user_id = v_user_id for update;

  update credit_wallets
  set held_balance = held_balance - v_credits_held,
      available_balance = available_balance + v_released_credits,
      lifetime_consumed = lifetime_consumed + v_delivered_credits
  where user_id = v_user_id
  returning available_balance into v_available;

  if v_delivered_credits > 0 then
    insert into credit_ledger (user_id, type, amount, reference_id, reason_code, balance_after)
    values (v_user_id, 'deduct', v_delivered_credits, p_run_id, 'company_search_delivered', v_available);
  end if;

  if v_released_credits > 0 then
    insert into credit_ledger (user_id, type, amount, reference_id, reason_code, balance_after)
    values (v_user_id, 'release', v_released_credits, p_run_id, 'company_search_' || p_outcome, v_available);
  end if;

  update enrichment_runs
  set status = p_outcome,
      delivered_count = greatest(p_delivered_count, 0),
      credits_charged = v_delivered_credits,
      credits_released = v_released_credits,
      completed_at = now()
  where id = p_run_id;
end;
$$;

revoke execute on function fn_resolve_run(uuid, text, integer) from public;
