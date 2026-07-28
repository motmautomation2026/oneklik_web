-- INV on pro forma → finalize same row with RCP on payment.
-- Proformas now use the INV series. On pay we convert the row to tax_invoice
-- and attach receipt_number (same sequence) + payment_id — no second INV.

begin;

-- ── fn_finalize_proforma_payment ────────────────────────────────────────
-- Idempotent: if this payment already has a tax invoice, return it.
-- If the proforma is already finalized for this payment, return it.
-- Otherwise convert the open proforma (INV-…) into a paid tax invoice + RCP.

create or replace function fn_finalize_proforma_payment(
  p_proforma_id uuid,
  p_payment_id uuid,
  p_payment_snapshot jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_inv invoices%rowtype;
  v_payment payments%rowtype;
  v_seq text;
  v_fy_label text;
  v_receipt_number text;
begin
  -- Already issued a tax invoice for this payment?
  select id into v_existing
  from invoices
  where payment_id = p_payment_id
    and document_type = 'tax_invoice'
  limit 1;

  if v_existing is not null then
    -- Race / fallback path left an open proforma — void it so Billing
    -- no longer shows "Payment due" next to the paid invoice.
    update invoices
    set status = 'void',
        related_tax_invoice_id = v_existing,
        updated_at = now()
    where id = p_proforma_id
      and document_type = 'proforma_invoice'
      and status = 'issued'
      and payment_id is null
      and id is distinct from v_existing;
    return v_existing;
  end if;

  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment_not_found';
  end if;
  if v_payment.status <> 'success' then
    raise exception 'payment_not_success';
  end if;

  select * into v_inv from invoices where id = p_proforma_id for update;
  if not found then
    raise exception 'proforma_not_found';
  end if;

  -- Already finalized (idempotent retry)
  if v_inv.document_type = 'tax_invoice'
     and v_inv.payment_id = p_payment_id
     and v_inv.receipt_number is not null then
    return v_inv.id;
  end if;

  if v_inv.document_type <> 'proforma_invoice' then
    raise exception 'not_a_proforma';
  end if;

  if v_inv.status not in ('issued', 'paid') then
    raise exception 'proforma_not_open';
  end if;

  if v_inv.payment_id is not null and v_inv.payment_id <> p_payment_id then
    raise exception 'proforma_already_linked';
  end if;

  if v_inv.user_id <> v_payment.user_id then
    raise exception 'user_mismatch';
  end if;

  -- INV-FY-NNNNNN → RCP-FY-NNNNNN (same sequence, no counter bump)
  -- invoice_number format: INV-{fy_label}-{6 digits}
  v_fy_label := split_part(v_inv.invoice_number, '-', 2);
  v_seq := split_part(v_inv.invoice_number, '-', 3);
  if v_fy_label = '' or v_seq = '' then
    raise exception 'invalid_invoice_number_format';
  end if;
  v_receipt_number := 'RCP-' || v_fy_label || '-' || v_seq;

  update invoices
  set document_type = 'tax_invoice',
      status = 'paid',
      payment_id = p_payment_id,
      receipt_number = v_receipt_number,
      payment_snapshot = coalesce(p_payment_snapshot, '{}'::jsonb),
      related_tax_invoice_id = null,
      updated_at = now()
  where id = p_proforma_id;

  return p_proforma_id;
exception
  when unique_violation then
    -- Concurrent finalize or race with fn_issue_invoice for same payment
    select id into v_existing
    from invoices
    where payment_id = p_payment_id
      and document_type = 'tax_invoice'
    limit 1;
    if v_existing is null then
      raise;
    end if;
    update invoices
    set status = 'void',
        related_tax_invoice_id = v_existing,
        updated_at = now()
    where id = p_proforma_id
      and document_type = 'proforma_invoice'
      and status = 'issued'
      and payment_id is null
      and id is distinct from v_existing;
    return v_existing;
end;
$$;

revoke all on function fn_finalize_proforma_payment(uuid, uuid, jsonb) from public;
grant execute on function fn_finalize_proforma_payment(uuid, uuid, jsonb) to service_role;

commit;
