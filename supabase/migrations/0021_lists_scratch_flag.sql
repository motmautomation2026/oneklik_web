-- 0021_lists_scratch_flag.sql
-- Adds a way to mark a list as an internal "scratch" bucket rather than a
-- real, user-created list.
--
-- WHY THIS EXISTS
-- Every reveal (Email Reveal, Phone Reveal, LinkedIn Lookup) needs a
-- list_items row to attach its billing outcome to (enrichment_results
-- references list_item_id), and list_items.list_id is NOT NULL — so a list
-- has to exist for that row to live in. Until now, every reveal action
-- created a brand-new, uniquely-named list as a side effect, even for a
-- single-row reveal the user never asked to "save" — cluttering the Lists
-- page with lists nobody intentionally created.
--
-- Fix: one evergreen, hidden list per user (per kind) for exactly this
-- purpose, created lazily on first use and reused forever after. The
-- explicit "Save to list" flow is untouched — it always creates a normal,
-- visible, user-named list, never this one.
--
-- Purely additive: new nullable-with-default column, no existing rows
-- change meaning (all existing lists are real, user-visible lists, so the
-- default of false is correct for every row that already exists).

begin;

alter table lists
  add column if not exists is_system boolean not null default false;

-- At most one system list per (user, kind) — the whole point is reuse, not
-- accumulation. A partial unique index (rather than a table-wide unique
-- constraint) so it only constrains the rows that matter.
create unique index if not exists lists_one_system_per_user_kind_idx
  on lists (user_id, kind)
  where is_system;

commit;
