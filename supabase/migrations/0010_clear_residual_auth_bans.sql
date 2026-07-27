-- 0010_clear_residual_auth_bans.sql
-- One-time data fix completing the ban relocation started in 0009.
--
-- ORDERING MATTERS — run this only AFTER deploying the backend change that
-- removed the GoTrue call from setUserAccountStatus. Run it before, and the
-- next ban an admin issues re-applies banned_until and puts us back where we
-- started. That is why it was deliberately left out of 0009.
--
-- WHAT IT DOES
-- Users banned under the 0007 scheme have auth.users.banned_until set, so
-- GoTrue refuses their sign-in outright. They therefore cannot reach the
-- lockout screen, cannot raise a support ticket, and cannot appeal — the exact
-- population the support feature exists to serve. This clears that flag.
--
-- WHAT IT DOES NOT DO
-- It does not unban anyone in any sense that matters. profiles.account_status
-- stays 'banned', so both enforcement layers keep applying:
--   - enforceAccountStatus rejects every product API route, and
--   - the account_can_write() RESTRICTIVE policies from 0009 reject the direct
--     browser-to-Postgres writes to lists/list_items.
-- The only capability restored is authenticating far enough to see "your
-- account has been banned" and file an appeal.
--
-- banned_until is the same column GoTrue's own ban_duration writes; clearing
-- it is exactly what ban_duration => 'none' does through the admin API.
--
-- Idempotent: re-running it affects zero rows.
--
-- PREVIEW FIRST (read-only — run this on its own before the migration):
--   select u.id, u.email, u.banned_until, p.account_status
--   from auth.users u
--   join profiles p on p.id = u.id
--   where u.banned_until is not null;
--
-- Expect Supabase's "destructive operations" warning on this file. It is
-- correct to warn — this is a genuine UPDATE against real rows. Proceed only
-- once the preview above shows the set you expect.
--
-- ROLLBACK: none is needed or meaningful. If you want a specific user
-- hard-locked at the auth layer again, do it deliberately through the
-- dashboard or the admin API rather than by reverting this file.

begin;

-- RETURNING so the affected rows are visible in the editor output — a record
-- of exactly who was changed, since there is no before-image to go back to.
update auth.users u
set banned_until = null
from profiles p
where p.id = u.id
  and p.account_status = 'banned'
  and u.banned_until is not null
returning u.id, u.email, p.account_status;

-- Postcondition: nobody is left locked out at the auth layer. Rows here would
-- mean a banned_until survived — either a profile row is missing, or someone
-- was banned directly in the dashboard rather than through the admin UI.
do $$
declare
  v_remaining int;
begin
  select count(*) into v_remaining from auth.users where banned_until is not null;
  if v_remaining > 0 then
    raise warning 'guard: % user(s) still have banned_until set and cannot sign in — check for profiles rows missing or dashboard-issued bans', v_remaining;
  else
    raise notice 'guard: no residual auth-layer bans remain';
  end if;
end $$;

commit;
