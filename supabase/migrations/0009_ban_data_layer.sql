-- 0009_ban_data_layer.sql
-- Moves ban enforcement from the auth layer to the data layer.
--
-- WHY THIS EXISTS
-- 0007 implemented 'banned' as a GoTrue kill: auth.admin.updateUserById with
-- ban_duration, which makes sign-in itself fail. That is strong, but it means
-- a banned user cannot log in — and therefore cannot reach the support system
-- to appeal. Product requirement is the opposite: a banned user logs in, lands
-- on the lockout screen, and can raise a request from there.
--
-- Simply deleting the GoTrue ban is NOT sufficient, and this is the important
-- part. lists and list_items are written *directly from the browser* with the
-- anon key (ListsPage, ListDetailPage, CompanySearchPage, PeopleSearchPage,
-- LinkedInLookupPage) under lists_all_own / list_items_all_own, which are
-- `for all` — read AND write. Those writes never touch Express, so the
-- enforceAccountStatus middleware does not see them. Today the GoTrue ban is
-- the only thing that stops them, and it does so within <= 1h (token expiry +
-- blocked refresh). Remove the ban with nothing in its place and a banned user
-- keeps a permanently refreshable session that can insert, rename and delete
-- lists forever.
--
-- So the ban does not weaken; it relocates. account_can_write() blocks the
-- write at the database, which is a layer the client cannot route around at
-- all — strictly better coverage than the middleware, and permanent rather
-- than expiring with a token.
--
-- ── HOW: RESTRICTIVE POLICIES, NOTHING DROPPED ──────────────────────────
-- An earlier draft of this migration dropped lists_all_own / list_items_all_own
-- and rebuilt them as four per-command policies each. That worked, but it
-- carried two risks that this version does not have:
--
--   1. Between the DROP and the CREATEs, the table has no write policy. A
--      failure in that window breaks the product for every user.
--   2. The rebuilt policies had to reproduce the original's exact semantics by
--      hand — including the asymmetry where SELECT/UPDATE/DELETE allow
--      `or is_admin()` but WITH CHECK is owner-only. One wrong clause and
--      active users lose write access.
--
-- Postgres has a purpose-built mechanism for "add a constraint on top of
-- existing policies": RESTRICTIVE policies. Permissive policies (the default,
-- and what 0001 uses) are OR'd together; restrictive policies are AND'd with
-- the result. So the original policies stay exactly as they are — still the
-- only thing granting access — and the policies below can only ever subtract.
--
-- Consequences:
--   - This migration is purely additive. Nothing is dropped or modified.
--   - Risk 2 disappears entirely: the granting policy is untouched, so there is
--     no chance of mis-transcribing it.
--   - Rollback is three DROP POLICY statements per table, after which the
--     database is byte-identical to its pre-migration state.
--   - SELECT is deliberately absent below. No restrictive policy covers it, so
--     reads are completely unaffected for every status — which the lockout
--     screen, the user's own support thread, and the admin views all rely on.
--
-- Roles: restrictive policies apply to PUBLIC here (no `to` clause), which is
-- intentional. service_role has BYPASSRLS and the table owner bypasses RLS, so
-- neither the backend service client nor migrations are affected. The `anon`
-- role gains nothing and loses nothing — it could never satisfy
-- `user_id = auth.uid()` in the permissive policy to begin with.
--
-- BLAST RADIUS
-- account_can_write() returns true for 'active' and 'frozen', so the AND is a
-- no-op for them and their behavior is unchanged by construction. Behavior
-- changes for exactly two statuses, in exactly one direction (writes denied).
--
-- NOT IN THIS MIGRATION
-- Clearing auth.users.banned_until for already-banned users is deliberately
-- deferred to Step 3. Until setUserAccountStatus stops calling GoTrue, a ban
-- issued between now and then would simply re-apply it, so doing it here would
-- be premature — and it keeps this migration free of any write to the auth
-- schema.
--
-- ROLLBACK (after a successful commit, if ever needed)
--   begin;
--   drop policy lists_restrict_insert on lists;
--   drop policy lists_restrict_update on lists;
--   drop policy lists_restrict_delete on lists;
--   drop policy list_items_restrict_insert on list_items;
--   drop policy list_items_restrict_update on list_items;
--   drop policy list_items_restrict_delete on list_items;
--   drop function account_can_write();
--   drop function account_status_can_write(text, timestamptz);
--   commit;

begin;

-- ── the rule, as a pure function ────────────────────────────────────────
-- Deliberately split from the caller-aware wrapper below so the rule itself
-- takes its inputs as arguments and can therefore be tested directly — which
-- is exactly what the guard at the bottom of this file does before committing.
-- A rule that can only be exercised through auth.uid() is a rule that can only
-- be tested in production.
--
-- Semantics mirror the two implementations that already exist, so all three
-- layers agree on what "locked" means:
--   - backend  enforceAccountStatus (lazy suspension expiry)
--   - frontend isLockedOut / isSuspensionExpired in lib/accountStatus.ts
--
--   active    -> true
--   frozen    -> true  (frozen is read-only w.r.t. CREDITS, not w.r.t. a user's
--                       own data; renaming or deleting a list they already own
--                       costs nothing and stays allowed, matching how frozen
--                       behaves everywhere else in the product today)
--   suspended -> true only once suspended_until has passed. An open-ended
--                suspension (null until) never auto-expires.
--   banned    -> false, always.
--
-- STABLE rather than IMMUTABLE because of now().
create or replace function account_status_can_write(
  p_status text,
  p_suspended_until timestamptz
)
returns boolean
language sql
stable
as $$
  select case
    when p_status = 'banned' then false
    when p_status = 'suspended'
      then p_suspended_until is not null and p_suspended_until <= now()
    else true
  end;
$$;

-- ── the caller-aware wrapper used by policies ───────────────────────────
-- Same shape as is_admin() from 0001: stable, security definer, pinned
-- search_path — it reads profiles, which is itself RLS-protected, so it has to
-- run as definer to be usable from inside a policy.
--
-- Returns false when there is no profile row for the caller. Unreachable in
-- practice for the policies below — lists.user_id is FK'd to profiles, so a
-- caller with no profile has nothing to write — and false is the safe default
-- regardless. The service role bypasses RLS entirely and never evaluates this.
create or replace function account_can_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select account_status_can_write(p.account_status, p.suspended_until)
    from profiles p
    where p.id = auth.uid()
  ), false);
$$;

-- ── lists: restrictive write gate ───────────────────────────────────────
-- lists_all_own is untouched and still the only policy granting access. These
-- three AND onto it for write commands only.

create policy lists_restrict_insert on lists
  as restrictive for insert
  with check (account_can_write());

create policy lists_restrict_update on lists
  as restrictive for update
  using (account_can_write())
  with check (account_can_write());

create policy lists_restrict_delete on lists
  as restrictive for delete
  using (account_can_write());

-- ── list_items: restrictive write gate ──────────────────────────────────

create policy list_items_restrict_insert on list_items
  as restrictive for insert
  with check (account_can_write());

create policy list_items_restrict_update on list_items
  as restrictive for update
  using (account_can_write())
  with check (account_can_write());

create policy list_items_restrict_delete on list_items
  as restrictive for delete
  using (account_can_write());

-- ── pre-commit guard ────────────────────────────────────────────────────
-- Verifies the rule and the resulting policy set before anything is durable.
-- Any mismatch raises, which aborts the transaction and leaves the database
-- exactly as it was. The failure mode this exists to prevent is a subtly wrong
-- predicate silently denying writes to *active* users — i.e. taking the core
-- product offline — which would otherwise only be discovered by a customer.

do $$
declare
  v_expected_restrictive text[] := array[
    'lists_restrict_insert', 'lists_restrict_update', 'lists_restrict_delete',
    'list_items_restrict_insert', 'list_items_restrict_update', 'list_items_restrict_delete'
  ];
  v_missing text[];
  v_permissive int;
  v_not_restrictive text[];
begin
  -- 1. The rule itself, across every reachable status.
  if account_status_can_write('active', null) is not true then
    raise exception 'guard: active must be allowed to write';
  end if;
  if account_status_can_write('frozen', null) is not true then
    raise exception 'guard: frozen must be allowed to write';
  end if;
  if account_status_can_write('suspended', null) is not false then
    raise exception 'guard: open-ended suspension must be denied';
  end if;
  if account_status_can_write('suspended', now() + interval '1 day') is not false then
    raise exception 'guard: unexpired suspension must be denied';
  end if;
  if account_status_can_write('suspended', now() - interval '1 day') is not true then
    raise exception 'guard: expired suspension must be allowed (matches backend lazy expiry)';
  end if;
  if account_status_can_write('banned', null) is not false then
    raise exception 'guard: banned must be denied';
  end if;

  -- 2. The original granting policies are still in place. If one of these ever
  --    went missing, the restrictive policies would have nothing to subtract
  --    from and every write would be denied — including active users.
  select count(*) into v_permissive
  from pg_policies
  where schemaname = 'public'
    and policyname in ('lists_all_own', 'list_items_all_own');

  if v_permissive <> 2 then
    raise exception 'guard: expected lists_all_own and list_items_all_own to still exist, found %', v_permissive;
  end if;

  -- 3. Every new policy exists...
  select array_agg(expected)
  into v_missing
  from unnest(v_expected_restrictive) as expected
  where not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('lists', 'list_items')
      and policyname = expected
  );

  if v_missing is not null then
    raise exception 'guard: missing restrictive policies: %', array_to_string(v_missing, ', ');
  end if;

  -- 4. ...and every one of them is actually RESTRICTIVE. A permissive policy
  --    here would be catastrophic in the opposite direction: it would OR in
  --    `account_can_write()` and hand every authenticated user write access to
  --    every row in the table. Worth asserting explicitly rather than trusting
  --    that `as restrictive` was not dropped from a line during an edit.
  select array_agg(policyname)
  into v_not_restrictive
  from pg_policies
  where schemaname = 'public'
    and policyname = any(v_expected_restrictive)
    and permissive <> 'RESTRICTIVE';

  if v_not_restrictive is not null then
    raise exception 'guard: these policies are PERMISSIVE but must be RESTRICTIVE: %',
      array_to_string(v_not_restrictive, ', ');
  end if;

  raise notice 'guard: all checks passed — committing';
end $$;

commit;
