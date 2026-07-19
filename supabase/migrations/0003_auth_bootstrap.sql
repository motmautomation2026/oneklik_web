-- 0003_auth_bootstrap.sql
-- Week 1, Day 5: on first verified login, create profile + wallet + the
-- one-time starter credit grant — atomically, server-side, exactly once.
-- Lives as a trigger on auth.users rather than an API endpoint so it can
-- never be skipped, double-fired, or raced by frontend behavior.
--
-- Two entry points, because "verified" happens at different moments:
--   - OAuth (Google): email_confirmed_at is already set the moment the
--     auth.users row is inserted.
--   - Email/password: the row is inserted unconfirmed, then confirmed
--     later when the user clicks the verification link (an UPDATE).

create or replace function fn_bootstrap_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  insert into credit_wallets (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  -- Starter credit amount is intentionally a literal here, not a config
  -- table — MVP scope is one flat grant. Revisit if pack sizes need to vary.
  perform fn_grant_credits(new.id, 50, 'promo_grant', null, 'signup_starter_credits');

  return new;
end;
$$;

create trigger auth_users_bootstrap_on_insert
  after insert on auth.users
  for each row
  when (new.email_confirmed_at is not null)
  execute function fn_bootstrap_new_user();

create trigger auth_users_bootstrap_on_confirm
  after update on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function fn_bootstrap_new_user();
