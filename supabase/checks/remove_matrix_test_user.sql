-- remove_matrix_test_user.sql
--
-- NOT a migration. One-off cleanup for the throwaway account created by the
-- Step 7 verification matrix (email support-matrix-*@example.invalid).
--
-- WHY IT NEEDS SQL AT ALL
-- The service role could not finish the job. Deleting a profile cascades to
-- credit_ledger, and 0001 installs a trigger that raises
-- 'credit_ledger is append-only' on any DELETE. That guard is doing exactly
-- what it should — it means NO user can be hard-deleted through the API, ever,
-- which is a property of this system worth knowing rather than a bug.
--
-- Everything the matrix created that COULD be removed already has been:
-- tickets, messages, events and lists are all confirmed at zero. What is left
-- is one auth user, its profile, its wallet and its signup ledger row.
--
-- Running this is OPTIONAL. The leftover account is inert: the address is
-- @example.invalid so it can receive nothing, and its password was random and
-- is gone. If you would rather keep the ledger untouched, skip this file — the
-- only cost is one stray row in your users list.
--
-- The trigger is disabled only for this transaction and only for this one
-- known user id, then restored. If any statement fails, the ROLLBACK leaves
-- the trigger exactly as it was.

begin;

-- Confirm the target before touching anything. Expect exactly one row.
select u.id, u.email, p.account_status
from auth.users u
left join profiles p on p.id = u.id
where u.email like 'support-matrix-%@example.invalid';

alter table credit_ledger disable trigger credit_ledger_no_delete;

-- Deleting the auth user cascades: auth.users -> profiles -> wallet, ledger,
-- lists, tickets. Scoped by the throwaway email pattern so it cannot reach a
-- real account.
delete from auth.users
where email like 'support-matrix-%@example.invalid';

alter table credit_ledger enable trigger credit_ledger_no_delete;

-- Postcondition: no test users left, and the trigger is back on.
select count(*) as remaining_test_users
from auth.users
where email like 'support-matrix-%@example.invalid';

select tgname, tgenabled
from pg_trigger
where tgrelid = 'credit_ledger'::regclass and not tgisinternal;

commit;
