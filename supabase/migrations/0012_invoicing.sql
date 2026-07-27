-- 0012_invoicing.sql
-- GST tax invoices for successful credit-pack purchases.
--
-- Purely additive relative to the live payment path:
--   - New tables for billing profiles + invoices
--   - Nullable columns on payments (old rows / in-flight checkouts stay valid)
--   - amount_minor_units widened to bigint (same values, larger type)
--   - Private storage bucket for cached PDFs
--
-- Invoice issuance is driven by the backend AFTER returning from the Razorpay
-- webhook. Credit grants (fn_grant_credits) are unchanged and remain the
-- source of truth for wallet balance. A missing invoice is repairable; a
-- failed credit grant is not — so the webhook still ACKs 200 if invoice
-- creation fails after credits were granted.
--
-- Pricing stays in backend/src/lib/creditPacks.ts. Historical accuracy comes
-- from payments.pack_snapshot and invoices.line_items, never from live packs.
--
-- ALL OR NOTHING — same reason as 0008: storage policies need ownership of
-- storage.objects and a mid-migration failure must not leave half the schema.

begin;

-- ── payments: additive columns ──────────────────────────────────────────
-- gateway_order_id mirrors the Razorpay order id. We keep writing the order
-- id into gateway_payment_id as well so the existing webhook lookup
-- (.eq("gateway_payment_id", order_id)) continues to work without a cutover.
-- gateway_capture_id holds the pay_xxx id once payment.captured arrives.
--
-- amount_minor_units meaning after this migration (for NEW checkouts only):
-- gross total charged including GST. Pre-launch rows remain base-price-only.
-- Documented intentionally — not worth a backfill.

alter table payments
  alter column amount_minor_units type bigint;

alter table payments
  add column if not exists gateway_order_id text,
  add column if not exists gateway_capture_id text,
  add column if not exists pack_id text,
  add column if not exists pack_snapshot jsonb,
  add column if not exists taxable_value_minor bigint,
  add column if not exists tax_minor bigint;

create index if not exists payments_gateway_order_id_idx
  on payments (gateway, gateway_order_id)
  where gateway_order_id is not null;

-- ── billing_profiles ────────────────────────────────────────────────────
-- One legal / tax identity per user. Snapshotted onto each invoice at issue
-- time, so later edits never mutate historical documents.

create table billing_profiles (
  user_id uuid primary key references profiles(id) on delete cascade,
  legal_name text not null check (char_length(trim(legal_name)) between 1 and 200),
  entity_type text not null check (entity_type in ('business', 'individual')),
  gstin text check (
    gstin is null
    or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$'
  ),
  address_line1 text not null check (char_length(trim(address_line1)) between 1 and 200),
  address_line2 text check (address_line2 is null or char_length(trim(address_line2)) <= 200),
  city text not null check (char_length(trim(city)) between 1 and 100),
  state_code text not null check (state_code ~ '^[0-9]{2}$'),
  state_name text not null check (char_length(trim(state_name)) between 1 and 100),
  postal_code text not null check (char_length(trim(postal_code)) between 4 and 12),
  country text not null default 'IN' check (country = 'IN'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger billing_profiles_set_updated_at
  before update on billing_profiles
  for each row execute function set_updated_at();

alter table billing_profiles enable row level security;

create policy billing_profiles_select_own on billing_profiles
  for select using (user_id = auth.uid() or is_admin());

create policy billing_profiles_insert_own on billing_profiles
  for insert with check (user_id = auth.uid());

create policy billing_profiles_update_own on billing_profiles
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── invoice_counters ────────────────────────────────────────────────────
-- Gapless per financial year. Do NOT use a Postgres SEQUENCE — rolled-back
-- transactions leave holes, and gaps in a GST series are an audit finding.

create table invoice_counters (
  financial_year text not null,
  series text not null,
  last_number integer not null default 0 check (last_number >= 0),
  primary key (financial_year, series)
);

alter table invoice_counters enable row level security;
-- No client policies. Service role only.

-- ── invoices ────────────────────────────────────────────────────────────
-- Immutable legal record. Snapshots are the source of truth for rendering;
-- never join live to billing_profiles or credit packs when displaying.

create table invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  payment_id uuid not null unique references payments(id),
  invoice_number text not null unique,
  receipt_number text not null unique,
  financial_year text not null,
  series text not null,
  invoice_date date not null,
  issued_at timestamptz not null default now(),
  document_type text not null default 'tax_invoice'
    check (document_type in ('tax_invoice', 'credit_note')),
  status text not null default 'issued'
    check (status in ('issued', 'cancelled')),
  seller_snapshot jsonb not null,
  buyer_snapshot jsonb not null,
  line_items jsonb not null,
  payment_snapshot jsonb not null default '{}'::jsonb,
  taxable_value_minor bigint not null check (taxable_value_minor >= 0),
  cgst_minor bigint not null default 0 check (cgst_minor >= 0),
  sgst_minor bigint not null default 0 check (sgst_minor >= 0),
  igst_minor bigint not null default 0 check (igst_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  tax_rate_bps integer not null check (tax_rate_bps between 0 and 10000),
  place_of_supply_state_code text not null,
  place_of_supply_state_name text not null,
  supply_type text not null check (supply_type in ('intra_state', 'inter_state')),
  amount_in_words text not null,
  currency text not null default 'INR',
  template_version integer not null default 1,
  pdf_storage_path text,
  pdf_sha256 text,
  original_invoice_id uuid references invoices(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_tax_parts_sum check (
    (cgst_minor + sgst_minor + igst_minor) = (total_minor - taxable_value_minor)
  ),
  constraint invoices_intra_or_inter check (
    (supply_type = 'intra_state' and igst_minor = 0)
    or (supply_type = 'inter_state' and cgst_minor = 0 and sgst_minor = 0)
  )
);

create trigger invoices_set_updated_at
  before update on invoices
  for each row execute function set_updated_at();

create index invoices_user_id_idx on invoices (user_id);
create index invoices_invoice_date_idx on invoices (invoice_date desc);
create index invoices_financial_year_idx on invoices (financial_year);

alter table invoices enable row level security;

create policy invoices_select_own on invoices
  for select using (user_id = auth.uid() or is_admin());
-- No insert/update/delete for clients. Service role only.

-- ── fn_next_invoice_number ──────────────────────────────────────────────

create or replace function fn_next_invoice_number(
  p_financial_year text,
  p_series text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into invoice_counters (financial_year, series, last_number)
  values (p_financial_year, p_series, 1)
  on conflict (financial_year, series) do update
    set last_number = invoice_counters.last_number + 1
  returning last_number into v_next;

  return v_next;
end;
$$;

revoke all on function fn_next_invoice_number(text, text) from public;
grant execute on function fn_next_invoice_number(text, text) to service_role;

-- ── fn_issue_invoice ────────────────────────────────────────────────────
-- Idempotent on payment_id. Allocates a gapless number and inserts the row
-- in one transaction. Returns the invoice id (existing or newly created).

create or replace function fn_issue_invoice(
  p_payment_id uuid,
  p_user_id uuid,
  p_financial_year text,
  p_series text,
  p_fy_label text,
  p_invoice_date date,
  p_seller_snapshot jsonb,
  p_buyer_snapshot jsonb,
  p_line_items jsonb,
  p_payment_snapshot jsonb,
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
  v_receipt_number text;
  v_id uuid;
begin
  select id into v_existing from invoices where payment_id = p_payment_id;
  if v_existing is not null then
    return v_existing;
  end if;

  v_number := fn_next_invoice_number(p_financial_year, p_series);
  v_invoice_number := p_series || '-' || p_fy_label || '-' || lpad(v_number::text, 6, '0');
  v_receipt_number := 'RCP-' || p_fy_label || '-' || lpad(v_number::text, 6, '0');

  insert into invoices (
    user_id,
    payment_id,
    invoice_number,
    receipt_number,
    financial_year,
    series,
    invoice_date,
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
    template_version
  ) values (
    p_user_id,
    p_payment_id,
    v_invoice_number,
    v_receipt_number,
    p_financial_year,
    p_series,
    p_invoice_date,
    p_seller_snapshot,
    p_buyer_snapshot,
    p_line_items,
    coalesce(p_payment_snapshot, '{}'::jsonb),
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
    p_template_version
  )
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    -- Concurrent webhook replay raced past the initial select.
    select id into v_existing from invoices where payment_id = p_payment_id;
    if v_existing is null then
      raise;
    end if;
    return v_existing;
end;
$$;

revoke all on function fn_issue_invoice(
  uuid, uuid, text, text, text, date, jsonb, jsonb, jsonb, jsonb,
  bigint, bigint, bigint, bigint, bigint, integer, text, text, text, text, text, integer
) from public;
grant execute on function fn_issue_invoice(
  uuid, uuid, text, text, text, date, jsonb, jsonb, jsonb, jsonb,
  bigint, bigint, bigint, bigint, bigint, integer, text, text, text, text, text, integer
) to service_role;

-- ── storage bucket: invoices ────────────────────────────────────────────
-- Private. Only the service role writes. Users can read objects under their
-- own user_id folder (signed URLs are still the preferred download path).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'invoices',
  'invoices',
  false,
  10485760,
  array['application/pdf']
)
on conflict (id) do nothing;

create policy invoices_object_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'invoices'
    and ((storage.foldername(name))[1] = auth.uid()::text or is_admin())
  );

-- No insert/update/delete policies for authenticated. Service role only.

commit;
