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
 * Single HTML+CSS template for in-app preview and PDF.
 * template_version 1 — Stripe-style Tax Invoice layout.
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
    .map(
      (t) => `
      <tr class="${t.bold ? "bold" : ""}">
        <td>${escapeHtml(t.label)}</td>
        <td class="num">${escapeHtml(t.amount_label)}</td>
      </tr>`,
    )
    .join("");

  const payRows = model.payment_history
    .map(
      (p) => `
      <tr>
        <td>${escapeHtml(p.method)}</td>
        <td>${escapeHtml(p.date_label)}</td>
        <td class="num">${escapeHtml(p.amount_label)}</td>
        <td class="mono">${escapeHtml(p.receipt_number)}</td>
      </tr>`,
    )
    .join("");

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
      margin: 0;
      padding: 0;
      font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
      color: #111;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 48px 48px 40px;
      margin: 0 auto;
    }
    .brand { color: #563da4; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 28px;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .header .logo {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      color: #563da4;
    }
    .meta {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 28px;
      font-size: 12px;
    }
    .meta td { padding: 3px 0; vertical-align: top; }
    .meta .label {
      width: 145px;
      font-weight: 600;
      color: #222;
    }
    .meta .value { color: #111; }
    .meta .status { font-weight: 700; }
    .parties {
      display: flex;
      gap: 32px;
      margin-bottom: 28px;
    }
    .party { flex: 1; font-size: 12px; line-height: 1.55; color: #222; }
    .party .title {
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .party .title.brand { color: #563da4; }
    .amount-line {
      margin: 8px 0 28px;
      font-size: 18px;
      font-weight: 700;
    }
    .amount-line .paid { color: #563da4; }
    table.items {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-bottom: 8px;
    }
    table.items thead th {
      text-align: left;
      font-weight: 600;
      padding: 0 0 8px;
      border-bottom: 1.5px solid #563da4;
      color: #222;
    }
    table.items thead th.num,
    table.items td.num { text-align: right; }
    table.items thead th.qty,
    table.items td.qty { text-align: center; width: 48px; }
    table.items tbody td {
      padding: 12px 0;
      border-bottom: 1px solid #ececec;
      vertical-align: top;
    }
    .desc-main { font-weight: 500; }
    .desc-sac { color: #888; font-size: 11px; margin-top: 2px; }
    .totals-wrap {
      display: flex;
      justify-content: flex-end;
      margin: 8px 0 32px;
    }
    table.totals {
      width: 260px;
      border-collapse: collapse;
      font-size: 12px;
    }
    table.totals td {
      padding: 7px 0;
      border-bottom: 1px solid #ececec;
    }
    table.totals td.num { text-align: right; }
    table.totals tr.bold td { font-weight: 700; }
    .section-title {
      font-size: 13px;
      font-weight: 700;
      margin: 0 0 8px;
    }
    table.pay {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-bottom: 28px;
    }
    table.pay thead th {
      text-align: left;
      font-weight: 600;
      padding: 0 0 8px;
      border-bottom: 1.5px solid #563da4;
    }
    table.pay thead th.num,
    table.pay td.num { text-align: right; }
    table.pay tbody td {
      padding: 10px 0;
      border-bottom: 1px solid #ececec;
    }
    .mono { font-variant-numeric: tabular-nums; }
    .footer {
      margin-top: 24px;
      font-size: 11px;
      color: #666;
      line-height: 1.55;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <h1>${escapeHtml(model.document_title)}</h1>
      <p class="logo">One-Klik</p>
    </div>

    <table class="meta">
      <tr><td class="label">${model.is_proforma ? "Pro forma number" : "Invoice number"}</td><td class="value mono">${escapeHtml(model.invoice_number)}</td></tr>
      ${
        model.receipt_number
          ? `<tr><td class="label">Receipt number</td><td class="value mono">${escapeHtml(model.receipt_number)}</td></tr>`
          : ""
      }
      <tr><td class="label">${model.is_proforma ? "Date issued" : "Date paid"}</td><td class="value">${escapeHtml(model.invoice_date_label)}</td></tr>
      ${
        model.due_date_label
          ? `<tr><td class="label">Payment due</td><td class="value">${escapeHtml(model.due_date_label)}</td></tr>`
          : ""
      }
      <tr><td class="label">Status</td><td class="value status">${escapeHtml(model.status)}</td></tr>
      <tr><td class="label">Place of supply</td><td class="value">${escapeHtml(model.place_of_supply)}</td></tr>
      ${model.note ? `<tr><td class="label">Note</td><td class="value">${escapeHtml(model.note)}</td></tr>` : ""}
    </table>

    <div class="parties">
      <div class="party">
        <div class="title brand">${escapeHtml(model.seller.legal_name)}</div>
        <div>${sellerLines}</div>
        <div>GST: ${escapeHtml(model.seller.gstin)}</div>
        ${model.seller.billing_email ? `<div>${escapeHtml(model.seller.billing_email)}</div>` : ""}
        ${model.seller.phone ? `<div>${escapeHtml(model.seller.phone)}</div>` : ""}
      </div>
      <div class="party">
        <div class="title">Bill To</div>
        <div>${escapeHtml(model.buyer.legal_name)}</div>
        ${model.buyer.company ? `<div>${escapeHtml(model.buyer.company)}</div>` : ""}
        <div>${buyerLines}</div>
        ${model.buyer.gstin ? `<div>GST: ${escapeHtml(model.buyer.gstin)}</div>` : ""}
        ${model.buyer.email ? `<div>${escapeHtml(model.buyer.email)}</div>` : ""}
      </div>
    </div>

    <div class="amount-line">
      ${
        model.is_proforma
          ? `<span class="paid">${escapeHtml(model.amount_due_label)}</span><span> due${
              model.due_date_label ? ` by ${escapeHtml(model.due_date_label)}` : ""
            }</span>`
          : `<span class="paid">${escapeHtml(model.amount_paid_label)}</span><span> paid on ${escapeHtml(model.paid_on_label)}</span>`
      }
    </div>

    <table class="items">
      <thead>
        <tr>
          <th>Description</th>
          <th class="qty">Qty</th>
          <th class="num">Unit price</th>
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
        ? `<p class="section-title">Payment instructions</p>
    <p class="footer">This is a pro forma invoice for your upcoming monthly plan renewal. A tax invoice and receipt will be issued after payment is received. Pay by the due date (or within the 3-day grace period) to keep unused credits rolled over on the same plan or an upgrade.</p>`
        : `<p class="section-title">Payment history</p>
    <table class="pay">
      <thead>
        <tr>
          <th>Payment method</th>
          <th>Date</th>
          <th class="num">Amount paid</th>
          <th class="num">Receipt number</th>
        </tr>
      </thead>
      <tbody>
        ${payRows}
      </tbody>
    </table>`
    }

    <div class="footer">
      <div>Amount in words: ${escapeHtml(model.amount_in_words)}</div>
      <div>Reverse charge: ${escapeHtml(model.reverse_charge)} · ${
        model.is_proforma
          ? "This is a computer-generated pro forma invoice and does not require a physical signature."
          : "This is a computer-generated receipt and does not require a physical signature."
      }</div>
    </div>
  </div>
</body>
</html>`;
}

export const INVOICE_TEMPLATE_VERSION = 1;
