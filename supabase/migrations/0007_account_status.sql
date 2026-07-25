-- 0007_account_status.sql
-- Admin moderation: freeze / suspend / ban a user. Purely additive —
-- account_status defaults to 'active' for every existing and future row, so
-- no current flow changes behavior until an admin explicitly acts. Actual
-- enforcement lives in the backend (requireAuth + enforceAccountStatus
-- middleware) and, for 'banned', at the Supabase auth layer (GoTrue ban +
-- session revoke); this migration only establishes the source of truth and
-- the audit trail.
--
-- States:
--   active    — normal, unrestricted (default)
--   frozen    — read-only: may log in and read own data, cannot spend credits
--   suspended — temporary full lockout (time-boxable via suspended_until)
--   banned    — permanent lockout, enforced at the auth layer

-- ── profiles: status columns ────────────────────────────────────────────

alter table profiles
  add column account_status text not null default 'active'
    check (account_status in ('active', 'frozen', 'suspended', 'banned')),
  add column status_reason text,
  add column suspended_until timestamptz,
  add column status_updated_at timestamptz,
  add column status_updated_by uuid references profiles(id);

-- Admins filter for the (small) set of non-active users; a partial index
-- keeps this tiny and fast regardless of how many active users exist.
create index profiles_account_status_idx on profiles(account_status)
  where account_status <> 'active';

-- Same shape as prevent_is_admin_self_escalation (0001): profiles_update_own
-- RLS lets a user update their own row, so without this guard a suspended
-- user could simply set account_status back to 'active'. Only the service
-- role (backend admin routes) may change any moderation field; a non-service
-- caller's attempt is silently reverted to the stored values rather than
-- rejected, mirroring the is_admin lock's behavior exactly.
create or replace function prevent_account_status_self_change()
returns trigger
language plpgsql
as $$
begin
  if auth.role() <> 'service_role' and (
       new.account_status   is distinct from old.account_status
    or new.status_reason    is distinct from old.status_reason
    or new.suspended_until  is distinct from old.suspended_until
    or new.status_updated_at is distinct from old.status_updated_at
    or new.status_updated_by is distinct from old.status_updated_by
  ) then
    new.account_status    := old.account_status;
    new.status_reason     := old.status_reason;
    new.suspended_until   := old.suspended_until;
    new.status_updated_at := old.status_updated_at;
    new.status_updated_by := old.status_updated_by;
  end if;
  return new;
end;
$$;

create trigger profiles_lock_account_status
  before update on profiles
  for each row execute function prevent_account_status_self_change();

-- ── moderation_actions (append-only audit log) ──────────────────────────
-- Every status change writes one row here. Append-only by policy: admins may
-- read and insert, but no update/delete policy exists (RLS default-denies
-- both), so moderation history can't be rewritten from a client. The backend
-- writes these via the service role (which bypasses RLS). This table is also
-- the anchor for the planned Phase 2 user ticket-raising flow.

create table moderation_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  action text not null check (action in ('freeze', 'suspend', 'ban', 'reactivate')),
  previous_status text not null check (previous_status in ('active', 'frozen', 'suspended', 'banned')),
  new_status text not null check (new_status in ('active', 'frozen', 'suspended', 'banned')),
  reason text,
  suspended_until timestamptz,
  acted_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index moderation_actions_user_id_idx on moderation_actions(user_id);

alter table moderation_actions enable row level security;

-- Admin-only, and append-only: read + insert allowed for admins, no update or
-- delete policy (default-denied) so the audit trail is immutable from clients.
create policy moderation_actions_admin_select on moderation_actions
  for select using (is_admin());

create policy moderation_actions_admin_insert on moderation_actions
  for insert with check (is_admin());
