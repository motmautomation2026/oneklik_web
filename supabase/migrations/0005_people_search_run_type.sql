-- 0005_people_search_run_type.sql
-- Adds 'people_search' as a valid enrichment_runs.run_type. It reuses the
-- exact same lump-sum billing path as company_search (fn_hold_credits +
-- fn_resolve_run) -- only the provider webhook and row shape differ.
-- Looks up the actual check-constraint name dynamically rather than
-- assuming the auto-generated name, so this is safe to run regardless of
-- how Postgres named it on creation.

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
  check (run_type in ('company_search', 'people_search', 'email_enrich', 'mobile_enrich'));
