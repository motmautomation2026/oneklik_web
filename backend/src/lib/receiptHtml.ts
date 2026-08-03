export interface PaymentReceiptRenderModel {
  invoice_number: string;
  receipt_number: string;
  transaction_id: string | null;
  date_paid_label: string;
  status: string;
  buyer_name: string;
  buyer_location: string | null;
  buyer_email: string | null;
  description: string;
  amount_paid_label: string;
  payment_method: string;
  seller_name: string;
  seller_support_email: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Basic payment receipt — matches the sample acknowledgement layout. */
export function renderPaymentReceiptHtml(model: PaymentReceiptRenderModel): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(model.receipt_number)}</title>
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
    .brand { color: #2262f0; font-size: 22px; font-weight: 700; margin: 0 0 8px; }
    h1 { margin: 0 0 8px; font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
    .ack { color: #444; font-size: 13px; margin: 0 0 28px; }
    .meta { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 8px; }
    .meta td { padding: 6px 0; vertical-align: top; }
    .meta .label { width: 150px; font-weight: 600; color: #333; }
    .meta .mono { font-variant-numeric: tabular-nums; }
    .meta .paid { color: #1a7f37; font-weight: 700; }
    .rule { border: none; border-top: 1.5px solid #2262f0; margin: 22px 0; }
    .section-label { color: #2262f0; font-weight: 700; font-size: 13px; margin: 0 0 10px; }
    .buyer-name { font-weight: 700; font-size: 14px; margin: 0 0 4px; }
    .muted { color: #444; font-size: 13px; line-height: 1.55; }
    .amount { color: #2262f0; font-weight: 700; font-size: 16px; }
    .footer { margin-top: 28px; font-size: 12px; color: #666; line-height: 1.6; }
    .thanks { margin-top: 16px; }
    .thanks .brand-sm { color: #2262f0; font-weight: 700; }
  </style>
</head>
<body>
  <div class="page">
    <p class="brand">Quick ICP</p>
    <h1>Payment Receipt</h1>
    <p class="ack">This is to acknowledge that we have received your payment.</p>

    <table class="meta">
      <tr><td class="label">Invoice Number</td><td class="mono">${escapeHtml(model.invoice_number)}</td></tr>
      <tr><td class="label">Receipt Number</td><td class="mono">${escapeHtml(model.receipt_number)}</td></tr>
      ${
        model.transaction_id
          ? `<tr><td class="label">Transaction ID</td><td class="mono">${escapeHtml(model.transaction_id)}</td></tr>`
          : ""
      }
      <tr><td class="label">Date Paid</td><td>${escapeHtml(model.date_paid_label)}</td></tr>
      <tr><td class="label">Payment Status</td><td class="paid">${escapeHtml(model.status)}</td></tr>
    </table>

    <hr class="rule" />
    <p class="section-label">Received From</p>
    <p class="buyer-name">${escapeHtml(model.buyer_name)}</p>
    <div class="muted">
      ${model.buyer_location ? `<div>${escapeHtml(model.buyer_location)}</div>` : ""}
      ${model.buyer_email ? `<div>${escapeHtml(model.buyer_email)}</div>` : ""}
    </div>

    <hr class="rule" />
    <p class="section-label">Payment Details</p>
    <div class="muted">
      <div>${escapeHtml(model.description)}</div>
      <div class="amount" style="margin: 8px 0;">${escapeHtml(model.amount_paid_label)}</div>
      <div>Payment Method: ${escapeHtml(model.payment_method)}</div>
    </div>

    <hr class="rule" />
    <div class="footer">
      <div>This is a computer-generated receipt and does not require a signature.</div>
      <div class="thanks">
        Thank you,<br/>
        <span class="brand-sm">${escapeHtml(model.seller_name)}</span><br/>
        ${model.seller_support_email ? escapeHtml(model.seller_support_email) : ""}
      </div>
    </div>
  </div>
</body>
</html>`;
}
