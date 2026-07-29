-- 0019_profiles_email.sql
-- Mirror auth.users.email onto profiles so admin search/list endpoints can
-- use indexed Postgres ilike instead of paging the entire GoTrue user list.
-- Kept in sync by the bootstrap trigger + an email-change trigger.

begin;

alter table profiles
  add column if not exists email text;

-- Backfill existing profiles from auth.users.
update profiles p
set email = u.email
from auth.users u
where u.id = p.id
  and p.email is distinct from u.email;

create index if not exists profiles_email_trgm_idx
  on profiles using gin (email gin_trgm_ops);

-- Bootstrap writes email on create (insert ... on conflict do update email).
create or replace function fn_bootstrap_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
    set email = excluded.email
    where profiles.email is distinct from excluded.email;

  insert into credit_wallets (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  -- Starter credit amount is intentionally a literal here, not a config
  -- table — MVP scope is one flat grant. Revisit if pack sizes need to vary.
  perform fn_grant_credits(new.id, 50, 'promo_grant', null, 'signup_starter_credits');

  return new;
end;
$$;

-- Keep the mirror current when a user changes email in auth.
create or replace function fn_sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update profiles
    set email = new.email
    where id = new.id
      and email is distinct from new.email;
  end if;
  return new;
end;
$$;

drop trigger if exists auth_users_sync_profile_email on auth.users;
create trigger auth_users_sync_profile_email
  after update of email on auth.users
  for each row
  execute function fn_sync_profile_email();

commit;
