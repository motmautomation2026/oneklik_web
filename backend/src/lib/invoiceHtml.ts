export interface InvoiceRenderModel {
  document_title: string;
  invoice_number: string;
  receipt_number: string | null;
  invoice_date_label: string;
  paid_on_label: string;
  due_date_label: string | null;
  status: string;
  note: string | null;
  place_of_supply: string;
  seller: {
    legal_name: string;
    gstin: string;
    address_lines: string[];
    billing_email: string | null;
    phone: string | null;
  };
  buyer: {
    legal_name: string;
    company: string | null;
    gstin: string | null;
    address_lines: string[];
    email: string | null;
  };
  amount_paid_label: string;
  amount_due_label: string;
  currency: string;
  line_items: Array<{
    description: string;
    sac_code: string | null;
    qty: number;
    unit_price_label: string;
    amount_label: string;
  }>;
  totals: Array<{ label: string; amount_label: string; bold?: boolean }>;
  payment_history: Array<{
    method: string;
    date_label: string;
    amount_label: string;
    receipt_number: string;
  }>;
  amount_in_words: string;
  reverse_charge: string;
  is_proforma: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Invoice / pro forma HTML template (sample-style layout).
 * Pro forma uses title "Pro Forma Invoice" with PAYMENT DUE badge.
 */
export function renderInvoiceHtml(model: InvoiceRenderModel): string {
  const sellerLines = model.seller.address_lines.map((l) => escapeHtml(l)).join("<br/>");
  const buyerLines = model.buyer.address_lines.map((l) => escapeHtml(l)).join("<br/>");

  const lineRows = model.line_items
    .map(
      (li) => `
      <tr>
        <td class="desc">
          <div class="desc-main">${escapeHtml(li.description)}</div>
          ${li.sac_code ? `<div class="desc-sac">SAC ${escapeHtml(li.sac_code)}</div>` : ""}
        </td>
        <td class="num qty">${li.qty}</td>
        <td class="num">${escapeHtml(li.unit_price_label)}</td>
        <td class="num">${escapeHtml(li.amount_label)}</td>
      </tr>`,
    )
    .join("");

  const totalRows = model.totals
    .filter((t) => !["Amount due", "Amount paid"].includes(t.label))
    .map(
      (t) => `
      <tr class="${t.bold ? "bold highlight" : ""}">
        <td>${escapeHtml(t.label)}</td>
        <td class="num">${escapeHtml(t.amount_label)}</td>
      </tr>`,
    )
    .join("");

  const statusClass =
    model.status === "PAID" ? "badge paid" : model.status === "VOID" ? "badge void" : "badge due";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(model.invoice_number)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 0;
      font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
      color: #111; background: #fff;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .page { width: 210mm; min-height: 297mm; padding: 48px 48px 40px; margin: 0 auto; }
    .header {
      display: flex; justify-content: space-between; align-items: flex-start;
      margin-bottom: 24px;
    }
    .logo { margin: 0; font-size: 24px; font-weight: 700; color: #563da4; }
    .doc-right { text-align: right; }
    .doc-right h1 { margin: 0; font-size: 26px; font-weight: 700; }
    .doc-right .inv-no { margin-top: 4px; font-size: 12px; font-variant-numeric: tabular-nums; color: #333; }
    .summary {
      margin-bottom: 24px; font-size: 13px; line-height: 1.7;
    }
    .summary .label { font-weight: 600; color: #333; display: inline-block; width: 110px; }
    .summary .amount-due { color: #563da4; font-size: 20px; font-weight: 700; margin: 8px 0; }
    .badge {
      display: inline-block; padding: 4px 12px; border-radius: 999px;
      font-size: 11px; font-weight: 700; letter-spacing: 0.02em;
    }
    .badge.due { background: #efe9fb; color: #563da4; }
    .badge.paid { background: #e6f6ec; color: #1a7f37; }
    .badge.void { background: #eee; color: #555; }
    .parties { display: flex; gap: 40px; margin: 24px 0 28px; }
    .party { flex: 1; font-size: 12px; line-height: 1.55; color: #222; }
    .party .title { font-size: 12px; font-weight: 700; color: #563da4; margin-bottom: 6px; }
    .party .name { font-weight: 700; }
    table.items {
      width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 8px;
    }
    table.items thead th {
      text-align: left; font-weight: 600; padding: 10px 8px;
      background: #efe9fb; color: #563da4;
    }
    table.items thead th.num, table.items td.num { text-align: right; }
    table.items thead th.qty, table.items td.qty { text-align: center; width: 48px; }
    table.items tbody td {
      padding: 12px 8px; border-bottom: 1px solid #ececec; vertical-align: top;
    }
    .desc-main { font-weight: 500; }
    .desc-sac { color: #888; font-size: 11px; margin-top: 2px; }
    .totals-wrap { display: flex; justify-content: flex-end; margin: 8px 0 28px; }
    table.totals { width: 260px; border-collapse: collapse; font-size: 12px; }
    table.totals td { padding: 7px 8px; border-bottom: 1px solid #ececec; }
    table.totals td.num { text-align: right; }
    table.totals tr.bold td { font-weight: 700; }
    table.totals tr.highlight td { background: #efe9fb; }
    .due-line { color: #563da4; font-weight: 700; font-size: 14px; text-align: right; margin: -16px 0 28px; padding-right: 8px; }
    .pay-box { margin: 8px 0 24px; font-size: 12px; color: #333; line-height: 1.6; }
    .pay-box .row { display: flex; gap: 12px; margin-bottom: 12px; align-items: flex-start; }
    .pay-box .icon {
      width: 28px; height: 28px; border-radius: 50%; background: #563da4; color: #fff;
      display: flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0;
    }
    .pay-box .title { font-weight: 700; }
    .note { font-size: 11px; color: #666; margin-bottom: 12px; }
    .footer { margin-top: 16px; font-size: 11px; color: #666; line-height: 1.55; border-top: 1px solid #e5e5e5; padding-top: 14px; }
    .mono { font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <p class="logo">One-Klik</p>
      <div class="doc-right">
        <h1>${escapeHtml(model.document_title)}</h1>
        <div class="inv-no mono">${escapeHtml(model.invoice_number)}</div>
      </div>
    </div>

    <div class="summary">
      <div><span class="label">${model.is_proforma ? "Invoice Date" : "Date Paid"}</span>${escapeHtml(model.invoice_date_label)}</div>
      ${
        model.is_proforma && model.due_date_label
          ? `<div><span class="label">Due Date</span>${escapeHtml(model.due_date_label)}</div>`
          : ""
      }
      ${
        model.is_proforma
          ? `<div class="amount-due">${escapeHtml(model.amount_due_label)}</div>
      <div><span class="label">Status</span><span class="${statusClass}">${escapeHtml(model.status)}</span></div>`
          : `<div><span class="label">Status</span><span class="${statusClass}">${escapeHtml(model.status)}</span></div>
      ${model.receipt_number ? `<div><span class="label">Receipt</span><span class="mono">${escapeHtml(model.receipt_number)}</span></div>` : ""}`
      }
    </div>

    ${model.note ? `<p class="note">${escapeHtml(model.note)}</p>` : ""}

    <div class="parties">
      <div class="party">
        <div class="title">From</div>
        <div class="name">${escapeHtml(model.seller.legal_name)}</div>
        <div>${sellerLines}</div>
        <div>GST: ${escapeHtml(model.seller.gstin)}</div>
        ${model.seller.billing_email ? `<div>${escapeHtml(model.seller.billing_email)}</div>` : ""}
        ${model.seller.phone ? `<div>${escapeHtml(model.seller.phone)}</div>` : ""}
      </div>
      <div class="party">
        <div class="title">Bill To</div>
        <div class="name">${escapeHtml(model.buyer.legal_name)}</div>
        ${model.buyer.company ? `<div>${escapeHtml(model.buyer.company)}</div>` : ""}
        <div>${buyerLines}</div>
        ${model.buyer.gstin ? `<div>GST: ${escapeHtml(model.buyer.gstin)}</div>` : ""}
        ${model.buyer.email ? `<div>${escapeHtml(model.buyer.email)}</div>` : ""}
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th>Description</th>
          <th class="qty">Qty</th>
          <th class="num">Unit Price</th>
          <th class="num">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${lineRows}
      </tbody>
    </table>

    <div class="totals-wrap">
      <table class="totals">
        ${totalRows}
      </table>
    </div>
    ${
      model.is_proforma
        ? `<div class="due-line">Amount Due ${escapeHtml(model.amount_due_label)}</div>`
        : `<div class="due-line">Amount Paid ${escapeHtml(model.amount_paid_label)}</div>`
    }

    ${
      model.is_proforma
        ? `<div class="pay-box">
      <div class="row">
        <div class="icon">1</div>
        <div>
          <div class="title">Payment Due</div>
          <div>Please pay the above amount${model.due_date_label ? ` by ${escapeHtml(model.due_date_label)}` : ""}. A 3-day grace period applies after the due date.</div>
        </div>
      </div>
      <div class="row">
        <div class="icon">2</div>
        <div>
          <div class="title">Bank / Payment</div>
          <div>You can make the payment via Razorpay from Billing or Plans.</div>
        </div>
      </div>
    </div>`
        : ""
    }

    <div class="footer">
      <div>Amount in words: ${escapeHtml(model.amount_in_words)}</div>
      <div>Place of supply: ${escapeHtml(model.place_of_supply)} · Reverse charge: ${escapeHtml(model.reverse_charge)}</div>
      <div>${
        model.is_proforma
          ? "This is a computer-generated pro forma invoice and does not require a signature."
          : "This is a computer-generated invoice and does not require a signature."
      }</div>
    </div>
  </div>
</body>
</html>`;
}

export const INVOICE_TEMPLATE_VERSION = 2;
