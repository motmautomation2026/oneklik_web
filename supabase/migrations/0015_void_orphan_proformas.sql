-- One-time heal: void open proformas that already have a paid tax invoice for the same renew
-- (or for the successor period created by that payment). Safe / idempotent.

begin;

update invoices pi
set status = 'void',
    related_tax_invoice_id = ti.id,
    updated_at = now()
from subscription_periods sp
join payments p
  on p.renews_period_id = sp.id
 and p.status = 'success'
join invoices ti
  on ti.payment_id = p.id
 and ti.document_type = 'tax_invoice'
where sp.proforma_id = pi.id
  and pi.document_type = 'proforma_invoice'
  and pi.status = 'issued'
  and pi.payment_id is null
  and pi.id is distinct from ti.id;

-- Fallback: PI linked via subscription_period_id when period.proforma_id was never set
update invoices pi
set status = 'void',
    related_tax_invoice_id = ti.id,
    updated_at = now()
from payments p
join invoices ti
  on ti.payment_id = p.id
 and ti.document_type = 'tax_invoice'
where p.renews_period_id = pi.subscription_period_id
  and p.status = 'success'
  and pi.document_type = 'proforma_invoice'
  and pi.status = 'issued'
  and pi.payment_id is null
  and pi.subscription_period_id is not null
  and pi.id is distinct from ti.id;

-- Fallback: period was succeeded by a paid next period (renews_period_id was null on payment)
update invoices pi
set status = 'void',
    related_tax_invoice_id = ti.id,
    updated_at = now()
from subscription_periods sp
join subscription_periods nxt
  on nxt.subscription_id = sp.subscription_id
 and nxt.id <> sp.id
 and nxt.period_start >= sp.period_end
 and nxt.payment_id is not null
join invoices ti
  on ti.payment_id = nxt.payment_id
 and ti.document_type = 'tax_invoice'
where (sp.proforma_id = pi.id or pi.subscription_period_id = sp.id)
  and pi.document_type = 'proforma_invoice'
  and pi.status = 'issued'
  and pi.payment_id is null
  and pi.id is distinct from ti.id;

commit;
