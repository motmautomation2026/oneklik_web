-- 0011_support_related_ticket.sql
-- Adds the ticket-to-ticket link that 0008 should have carried.
--
-- Replying to a CLOSED ticket does not reopen it (see REOPEN_WINDOW_DAYS in
-- backend/src/support/types.ts — a reply reopens 'resolved', but 'closed' is
-- final). The user starts a new ticket instead, and this column preserves the
-- lineage so an admin opening ticket #1105 can see it continues #1042 rather
-- than reading it as an unrelated first contact.
--
-- Purely additive: one nullable column and one partial index. Nothing existing
-- is modified, and no code reads it until the support API ships.
--
-- ON DELETE SET NULL rather than CASCADE — deleting an old ticket must never
-- silently delete the newer one that references it.

begin;

alter table support_tickets
  add column related_ticket_id uuid references support_tickets(id) on delete set null;

-- Partial: the overwhelming majority of tickets have no predecessor, and this
-- is only ever queried in the "show me the chain" direction.
create index support_tickets_related_idx on support_tickets(related_ticket_id)
  where related_ticket_id is not null;

commit;
