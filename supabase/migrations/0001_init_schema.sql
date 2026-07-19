-- 0001_init_schema.sql
-- Week 1, Days 1-2: core schema + RLS. No wallet-mutating logic here —
-- credit_ledger and credit_wallets are read-only to end users; all writes
-- happen through Postgres RPC functions added in the next migration
-- (fn_hold_credits / fn_resolve_row / fn_release_remaining / fn_grant_credits).

create extension if not exists pgcrypto;

-- ── helpers ─────────────────────────────────────────────────────────────

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from profiles p where p.id = auth.uid()), false);
$$;

-- ── profiles ────────────────────────────────────────────────────────────

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company text,
  role text,
  use_case text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- Prevent a user from granting themselves admin via a normal profile update.
-- Only the service role (admin routes, backend) may flip is_admin.
create or replace function prevent_is_admin_self_escalation()
returns trigger
language plpgsql
as $$
begin
  if new.is_admin is distinct from old.is_admin and auth.role() <> 'service_role' then
    new.is_admin := old.is_admin;
  end if;
  return new;
end;
$$;

create trigger profiles_lock_is_admin
  before update on profiles
  for each row execute function prevent_is_admin_self_escalation();

alter table profiles enable row level security;

create policy profiles_select_own on profiles
  for select using (id = auth.uid() or is_admin());

create policy profiles_update_own on profiles
  for update using (id = auth.uid() or is_admin());

create policy profiles_insert_own on profiles
  for insert with check (id = auth.uid());

-- ── credit_wallets ──────────────────────────────────────────────────────

create table credit_wallets (
  user_id uuid primary key references profiles(id) on delete cascade,
  available_balance integer not null default 0 check (available_balance >= 0),
  held_balance integer not null default 0 check (held_balance >= 0),
  lifetime_purchased integer not null default 0,
  lifetime_consumed integer not null default 0,
  updated_at timestamptz not null default now()
);

create trigger credit_wallets_set_updated_at
  before update on credit_wallets
  for each row execute function set_updated_at();

alter table credit_wallets enable row level security;

-- Read-only to end users. All mutations go through RPC functions running
-- as the table owner / service role, never through direct client writes.
create policy credit_wallets_select_own on credit_wallets
  for select using (user_id = auth.uid() or is_admin());

-- ── credit_ledger (append-only) ────────────────────────────────────────

create table credit_ledger (
  id bigserial primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in ('hold', 'deduct', 'release', 'purchase', 'promo_grant', 'admin_adjustment')),
  amount integer not null,
  reference_id uuid,
  row_reference uuid,
  reason_code text,
  balance_after integer not null,
  created_at timestamptz not null default now()
);

create index credit_ledger_user_id_idx on credit_ledger(user_id);
create index credit_ledger_reference_id_idx on credit_ledger(reference_id);

alter table credit_ledger enable row level security;

create policy credit_ledger_select_own on credit_ledger
  for select using (user_id = auth.uid() or is_admin());

-- Append-only at the database level: no update or delete policy is created
-- (RLS default-denies both), and this trigger blocks even service-role callers
-- from mutating history — corrections must be new admin_adjustment rows.
create or replace function block_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'credit_ledger is append-only';
end;
$$;

create trigger credit_ledger_no_update
  before update on credit_ledger
  for each row execute function block_ledger_mutation();

create trigger credit_ledger_no_delete
  before delete on credit_ledger
  for each row execute function block_ledger_mutation();

-- ── lists / list_items ──────────────────────────────────────────────────

create table lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('company', 'people')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger lists_set_updated_at
  before update on lists
  for each row execute function set_updated_at();

create index lists_user_id_idx on lists(user_id);

alter table lists enable row level security;

create policy lists_all_own on lists
  for all using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid());

create table list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references lists(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  enrichment_status text not null default 'pending' check (enrichment_status in ('pending', 'enriched', 'not_found', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger list_items_set_updated_at
  before update on list_items
  for each row execute function set_updated_at();

create index list_items_list_id_idx on list_items(list_id);
create index list_items_user_id_idx on list_items(user_id);

alter table list_items enable row level security;

create policy list_items_all_own on list_items
  for all using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid());

-- ── enrichment_runs / enrichment_results ───────────────────────────────

create table enrichment_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  list_id uuid references lists(id) on delete set null,
  run_type text not null check (run_type in ('company_search', 'email_enrich', 'mobile_enrich')),
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'cancelled', 'failed')),
  requested_count integer not null default 0,
  delivered_count integer not null default 0,
  credits_held integer not null default 0,
  credits_charged integer not null default 0,
  credits_released integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index enrichment_runs_user_id_idx on enrichment_runs(user_id);

alter table enrichment_runs enable row level security;

-- Users read their own runs; only backend (service role) creates/updates them.
create policy enrichment_runs_select_own on enrichment_runs
  for select using (user_id = auth.uid() or is_admin());

create table enrichment_results (
  id bigserial primary key,
  run_id uuid not null references enrichment_runs(id) on delete cascade,
  list_item_id uuid not null references list_items(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null,
  outcome text not null check (outcome in ('found', 'not_found', 'error')),
  cost integer not null default 0,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index enrichment_results_run_id_idx on enrichment_results(run_id);
create index enrichment_results_list_item_id_idx on enrichment_results(list_item_id);
create index enrichment_results_user_id_idx on enrichment_results(user_id);

alter table enrichment_results enable row level security;

create policy enrichment_results_select_own on enrichment_results
  for select using (user_id = auth.uid() or is_admin());

-- ── payments ────────────────────────────────────────────────────────────

create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  gateway text not null check (gateway in ('razorpay', 'stripe')),
  gateway_payment_id text,
  status text not null default 'initiated' check (status in ('initiated', 'pending', 'success', 'failed')),
  credits_promised integer not null,
  amount_minor_units integer not null,
  currency text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger payments_set_updated_at
  before update on payments
  for each row execute function set_updated_at();

create unique index payments_gateway_payment_id_idx on payments(gateway, gateway_payment_id)
  where gateway_payment_id is not null;
create index payments_user_id_idx on payments(user_id);

alter table payments enable row level security;

-- Users only ever read their own payment history. Rows are created and
-- transitioned exclusively by the backend (checkout endpoint + webhook
-- handler) via the service role, so a client can never fabricate a
-- "success" status for itself.
create policy payments_select_own on payments
  for select using (user_id = auth.uid() or is_admin());

-- ── flagged_accounts ────────────────────────────────────────────────────

create table flagged_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  reason text not null,
  source text not null,
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references profiles(id)
);

create index flagged_accounts_user_id_idx on flagged_accounts(user_id);

alter table flagged_accounts enable row level security;

-- Admin-only in both directions; no end-user access at all.
create policy flagged_accounts_admin_only on flagged_accounts
  for all using (is_admin())
  with check (is_admin());
