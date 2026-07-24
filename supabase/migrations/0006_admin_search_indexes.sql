-- 0006_admin_search_indexes.sql
-- The admin dashboard searches lists.name and profiles.company with
-- ilike('%term%') (backend/src/admin/queries.ts: getLists, getUsers,
-- getAllUsersForExport). A leading wildcard defeats a plain btree index, so
-- without this these searches degrade to a sequential scan as the tables
-- grow. pg_trgm's GIN index supports arbitrary substring ilike matches
-- efficiently. Purely additive — no existing query needs to change.

create extension if not exists pg_trgm;

create index if not exists lists_name_trgm_idx on lists using gin (name gin_trgm_ops);
create index if not exists profiles_company_trgm_idx on profiles using gin (company gin_trgm_ops);
