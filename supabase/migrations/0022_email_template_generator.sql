-- 0022_email_template_generator.sql
-- Email Template Generator: generations history, optional brochure storage,
-- per-subscription-period free quota (20), then 1-credit billing via
-- enrichment_runs + fn_hold_credits / fn_resolve_run.
--
-- Free quota is gated on subscriptions.status IN ('active','past_due') AND
-- current_period_id — never on period id alone (expire leaves the old id).

begin;

-- ── enrichment_runs.run_type: add email_template ────────────────────────

do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'enrichment_runs'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%run_type%';

  if v_constraint_name is not null then
    execute format('alter table enrichment_runs drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table enrichment_runs
  add constraint enrichment_runs_run_type_check
  check (run_type in (
    'company_search',
    'people_search',
    'email_enrich',
    'mobile_enrich',
    'email_template'
  ));

-- ── email_template_generations ──────────────────────────────────────────

create table email_template_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  user_request text,
  company_profile text,
  company_website text,
  subject text,
  body text,
  billing_type text check (billing_type is null or billing_type in ('free', 'credit')),
  credits_charged integer not null default 0 check (credits_charged >= 0),
  enrichment_run_id uuid references enrichment_runs(id) on delete set null,
  subscription_period_id uuid references subscription_periods(id) on delete set null,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index email_template_generations_user_created_idx
  on email_template_generations (user_id, created_at desc);

create index email_template_generations_period_idx
  on email_template_generations (subscription_period_id)
  where subscription_period_id is not null;

alter table email_template_generations enable row level security;

create policy email_template_generations_select_own on email_template_generations
  for select using (user_id = auth.uid() or is_admin());

-- ── email_template_attachments ──────────────────────────────────────────

create table email_template_attachments (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references email_template_generations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null default 'brochure' check (kind = 'brochure'),
  storage_path text not null unique,
  filename text not null check (char_length(filename) between 1 and 255),
  mime_type text not null check (mime_type in (
    'image/png', 'image/jpeg', 'image/webp', 'application/pdf'
  )),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  created_at timestamptz not null default now()
);

create unique index email_template_attachments_one_brochure_idx
  on email_template_attachments (generation_id)
  where kind = 'brochure';

create index email_template_attachments_user_idx
  on email_template_attachments (user_id);

alter table email_template_attachments enable row level security;

create policy email_template_attachments_select_own on email_template_attachments
  for select using (user_id = auth.uid() or is_admin());

-- ── email_template_period_usage ─────────────────────────────────────────

create table email_template_period_usage (
  subscription_period_id uuid primary key references subscription_periods(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  free_used integer not null default 0 check (free_used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index email_template_period_usage_user_idx
  on email_template_period_usage (user_id);

alter table email_template_period_usage enable row level security;

create policy email_template_period_usage_select_own on email_template_period_usage
  for select using (user_id = auth.uid() or is_admin());

-- ── storage bucket ──────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'email-template-uploads',
  'email-template-uploads',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

create policy email_template_uploads_object_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'email-template-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy email_template_uploads_object_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'email-template-uploads'
    and ((storage.foldername(name))[1] = auth.uid()::text or is_admin())
  );

-- ── fn_reserve_email_template_generation ────────────────────────────────
-- Atomically chooses free vs credit billing and flips the generation to
-- running. Service-role only.

create or replace function fn_reserve_email_template_generation(
  p_user_id uuid,
  p_generation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gen email_template_generations%rowtype;
  v_sub_status text;
  v_period_id uuid;
  v_free_used integer;
  v_run_id uuid;
  c_free_limit constant integer := 20;
begin
  select * into v_gen
  from email_template_generations
  where id = p_generation_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'generation % not found for user %', p_generation_id, p_user_id;
  end if;

  if v_gen.status <> 'pending' then
    raise exception 'generation % is not pending (status=%)', p_generation_id, v_gen.status;
  end if;

  select status, current_period_id
  into v_sub_status, v_period_id
  from subscriptions
  where user_id = p_user_id
  for update;

  -- Free path: active or past_due plan period with remaining quota.
  if found
     and v_sub_status in ('active', 'past_due')
     and v_period_id is not null
  then
    insert into email_template_period_usage (subscription_period_id, user_id, free_used)
    values (v_period_id, p_user_id, 0)
    on conflict (subscription_period_id) do nothing;

    select free_used into v_free_used
    from email_template_period_usage
    where subscription_period_id = v_period_id
    for update;

    if v_free_used < c_free_limit then
      update email_template_period_usage
      set free_used = free_used + 1,
          updated_at = now()
      where subscription_period_id = v_period_id;

      update email_template_generations
      set status = 'running',
          billing_type = 'free',
          subscription_period_id = v_period_id
      where id = p_generation_id;

      return jsonb_build_object(
        'billing_type', 'free',
        'free_used', v_free_used + 1,
        'free_limit', c_free_limit,
        'subscription_period_id', v_period_id
      );
    end if;
  end if;

  -- Credit path: hold 1 credit via enrichment_runs.
  insert into enrichment_runs (user_id, run_type, status, requested_count)
  values (p_user_id, 'email_template', 'pending', 1)
  returning id into v_run_id;

  perform fn_hold_credits(p_user_id, v_run_id, 1);

  update email_template_generations
  set status = 'running',
      billing_type = 'credit',
      enrichment_run_id = v_run_id
  where id = p_generation_id;

  return jsonb_build_object(
    'billing_type', 'credit',
    'enrichment_run_id', v_run_id,
    'free_limit', c_free_limit
  );
end;
$$;

revoke all on function fn_reserve_email_template_generation(uuid, uuid) from public;
grant execute on function fn_reserve_email_template_generation(uuid, uuid) to service_role;

-- ── fn_finalize_email_template_generation ───────────────────────────────

create or replace function fn_finalize_email_template_generation(
  p_generation_id uuid,
  p_outcome text,
  p_subject text default null,
  p_body text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gen email_template_generations%rowtype;
  v_free_used integer;
begin
  if p_outcome not in ('completed', 'failed') then
    raise exception 'invalid outcome %, expected completed or failed', p_outcome;
  end if;

  select * into v_gen
  from email_template_generations
  where id = p_generation_id
  for update;

  if not found then
    raise exception 'generation % not found', p_generation_id;
  end if;

  if v_gen.status <> 'running' then
    raise exception 'generation % is not running (status=%), refusing to finalize twice',
      p_generation_id, v_gen.status;
  end if;

  if v_gen.billing_type = 'free' then
    if p_outcome = 'failed' and v_gen.subscription_period_id is not null then
      select free_used into v_free_used
      from email_template_period_usage
      where subscription_period_id = v_gen.subscription_period_id
      for update;

      if found and v_free_used > 0 then
        update email_template_period_usage
        set free_used = free_used - 1,
            updated_at = now()
        where subscription_period_id = v_gen.subscription_period_id;
      end if;
    end if;

    update email_template_generations
    set status = p_outcome,
        subject = case when p_outcome = 'completed' then p_subject else null end,
        body = case when p_outcome = 'completed' then p_body else null end,
        error_message = case when p_outcome = 'failed' then p_error else null end,
        credits_charged = 0,
        completed_at = now()
    where id = p_generation_id;

  elsif v_gen.billing_type = 'credit' then
    if v_gen.enrichment_run_id is null then
      raise exception 'generation % billed as credit but has no enrichment_run_id', p_generation_id;
    end if;

    if p_outcome = 'completed' then
      perform fn_resolve_run(v_gen.enrichment_run_id, 'completed', 1);
      update email_template_generations
      set status = 'completed',
          subject = p_subject,
          body = p_body,
          error_message = null,
          credits_charged = 1,
          completed_at = now()
      where id = p_generation_id;
    else
      perform fn_resolve_run(v_gen.enrichment_run_id, 'failed', 0);
      update email_template_generations
      set status = 'failed',
          subject = null,
          body = null,
          error_message = p_error,
          credits_charged = 0,
          completed_at = now()
      where id = p_generation_id;
    end if;

  else
    raise exception 'generation % has no billing_type set', p_generation_id;
  end if;
end;
$$;

revoke all on function fn_finalize_email_template_generation(uuid, text, text, text, text) from public;
grant execute on function fn_finalize_email_template_generation(uuid, text, text, text, text) to service_role;

commit;
