import PDFDocument from "pdfkit";
import type { InvoiceRenderModel } from "./invoiceHtml.js";

const BRAND = "#563da4";
const PAGE_MARGIN = 48;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2; // A4 width in points

/** Helvetica lacks the ₹ glyph — keep PDF text readable. */
function pdfSafe(s: string): string {
  return s.replace(/\u20B9/g, "Rs.");
}

/**
 * Render the invoice PDF in-process with pdfkit.
 * No Gotenberg, no extra container, no env vars — same deploy as today.
 */
export function renderInvoicePdf(model: InvoiceRenderModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
      info: {
        Title: model.invoice_number,
        Author: "One-Klik",
        Subject: "Receipt",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = PAGE_MARGIN;
    const right = PAGE_MARGIN + CONTENT_WIDTH;
    let y = PAGE_MARGIN;

    // Header
    doc.fillColor("#111").font("Helvetica-Bold").fontSize(22).text("Receipt", left, y, { lineBreak: false });
    doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(18).text("One-Klik", left, y, {
      width: CONTENT_WIDTH,
      align: "right",
      lineBreak: false,
    });
    y += 36;

    // Meta block
    doc.fillColor("#111").fontSize(9);
    const meta: Array<[string, string]> = [
      ["Invoice number", model.invoice_number],
      ["Receipt number", model.receipt_number],
      ["Date paid", model.invoice_date_label],
      ["Status", model.status],
      ["Place of supply", model.place_of_supply],
    ];
    if (model.note) meta.push(["Note", model.note]);

    for (const [label, value] of meta) {
      doc.font("Helvetica-Bold").text(label, left, y, { width: 130, lineBreak: false });
      doc.font("Helvetica").text(pdfSafe(value), left + 140, y, { width: CONTENT_WIDTH - 140 });
      y += 14;
    }
    y += 16;

    // Parties
    const colWidth = (CONTENT_WIDTH - 24) / 2;
    const sellerX = left;
    const buyerX = left + colWidth + 24;
    const partiesTop = y;

    doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(10).text(model.seller.legal_name, sellerX, partiesTop, {
      width: colWidth,
    });
    let sy = doc.y + 2;
    doc.fillColor("#222").font("Helvetica").fontSize(9);
    for (const line of model.seller.address_lines) {
      doc.text(pdfSafe(line), sellerX, sy, { width: colWidth });
      sy = doc.y;
    }
    doc.text(`GST: ${model.seller.gstin}`, sellerX, sy, { width: colWidth });
    sy = doc.y;
    if (model.seller.billing_email) {
      doc.text(model.seller.billing_email, sellerX, sy, { width: colWidth });
      sy = doc.y;
    }
    if (model.seller.phone) {
      doc.text(model.seller.phone, sellerX, sy, { width: colWidth });
      sy = doc.y;
    }

    doc.fillColor("#111").font("Helvetica-Bold").fontSize(10).text("Bill To", buyerX, partiesTop, { width: colWidth });
    let by = doc.y + 2;
    doc.fillColor("#222").font("Helvetica").fontSize(9);
    doc.text(pdfSafe(model.buyer.legal_name), buyerX, by, { width: colWidth });
    by = doc.y;
    if (model.buyer.company) {
      doc.text(pdfSafe(model.buyer.company), buyerX, by, { width: colWidth });
      by = doc.y;
    }
    for (const line of model.buyer.address_lines) {
      doc.text(pdfSafe(line), buyerX, by, { width: colWidth });
      by = doc.y;
    }
    if (model.buyer.gstin) {
      doc.text(`GST: ${model.buyer.gstin}`, buyerX, by, { width: colWidth });
      by = doc.y;
    }
    if (model.buyer.email) {
      doc.text(model.buyer.email, buyerX, by, { width: colWidth });
      by = doc.y;
    }

    y = Math.max(sy, by) + 20;

    // Amount line
    doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(14).text(pdfSafe(model.amount_paid_label), left, y, {
      continued: true,
    });
    doc.fillColor("#111").text(` paid on ${model.paid_on_label}`);
    y = doc.y + 18;

    // Line items header
    const descW = CONTENT_WIDTH - 200;
    const qtyX = left + descW;
    const unitX = qtyX + 40;
    const amtX = unitX + 80;

    doc.moveTo(left, y).strokeColor(BRAND).lineWidth(1.2).lineTo(right, y).stroke();
    y += 8;
    doc.fillColor("#222").font("Helvetica-Bold").fontSize(9);
    doc.text("Description", left, y, { width: descW, lineBreak: false });
    doc.text("Qty", qtyX, y, { width: 40, align: "center", lineBreak: false });
    doc.text("Unit price", unitX, y, { width: 80, align: "right", lineBreak: false });
    doc.text("Amount", amtX, y, { width: 80, align: "right", lineBreak: false });
    y += 14;
    doc.moveTo(left, y).strokeColor(BRAND).lineWidth(1.2).lineTo(right, y).stroke();
    y += 10;

    doc.font("Helvetica").fillColor("#111");
    for (const li of model.line_items) {
      const rowTop = y;
      doc.font("Helvetica").fontSize(9).text(pdfSafe(li.description), left, rowTop, { width: descW });
      let rowBottom = doc.y;
      if (li.sac_code) {
        doc.fillColor("#888").fontSize(8).text(`SAC ${li.sac_code}`, left, rowBottom, { width: descW });
        rowBottom = doc.y;
        doc.fillColor("#111");
      }
      doc.font("Helvetica").fontSize(9);
      doc.text(String(li.qty), qtyX, rowTop, { width: 40, align: "center", lineBreak: false });
      doc.text(pdfSafe(li.unit_price_label), unitX, rowTop, { width: 80, align: "right", lineBreak: false });
      doc.text(pdfSafe(li.amount_label), amtX, rowTop, { width: 80, align: "right", lineBreak: false });
      y = Math.max(rowBottom, rowTop + 14) + 8;
      doc
        .moveTo(left, y)
        .strokeColor("#ececec")
        .lineWidth(0.6)
        .lineTo(right, y)
        .stroke();
      y += 8;
    }

    // Totals
    y += 4;
    const totalsWidth = 220;
    const totalsLabelX = right - totalsWidth;
    const totalsValueX = right - 90;
    for (const t of model.totals) {
      if (t.bold) doc.font("Helvetica-Bold");
      else doc.font("Helvetica");
      doc.fontSize(9).fillColor("#111");
      doc.text(t.label, totalsLabelX, y, { width: 120, lineBreak: false });
      doc.text(pdfSafe(t.amount_label), totalsValueX, y, { width: 90, align: "right", lineBreak: false });
      y += 16;
      doc
        .moveTo(totalsLabelX, y - 4)
        .strokeColor("#ececec")
        .lineWidth(0.5)
        .lineTo(right, y - 4)
        .stroke();
    }

    y += 18;
    doc.fillColor("#111").font("Helvetica-Bold").fontSize(10).text("Payment history", left, y);
    y = doc.y + 6;
    doc.moveTo(left, y).strokeColor(BRAND).lineWidth(1.2).lineTo(right, y).stroke();
    y += 8;

    // Fixed columns with gaps so Amount paid and Receipt number never collide.
    // (Earlier layout butted those two columns at the same x edge.)
    const gap = 10;
    const methodW = 150;
    const dateW = 105;
    const amountW = 95;
    const receiptW = CONTENT_WIDTH - methodW - dateW - amountW - gap * 3;
    const payCols: Array<{ label: string; x: number; w: number; align: "left" | "right" }> = [
      { label: "Payment method", x: left, w: methodW, align: "left" },
      { label: "Date", x: left + methodW + gap, w: dateW, align: "left" },
      { label: "Amount paid", x: left + methodW + dateW + gap * 2, w: amountW, align: "right" },
      {
        label: "Receipt number",
        x: left + methodW + dateW + amountW + gap * 3,
        w: receiptW,
        align: "left",
      },
    ];

    const headerY = y;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#222");
    for (const col of payCols) {
      doc.text(col.label, col.x, headerY, {
        width: col.w,
        align: col.align,
        lineBreak: false,
      });
    }
    y = headerY + 14;
    doc.moveTo(left, y).strokeColor(BRAND).lineWidth(1.2).lineTo(right, y).stroke();
    y += 8;

    doc.font("Helvetica").fontSize(9).fillColor("#111");
    for (const p of model.payment_history) {
      const rowY = y;
      const values = [
        pdfSafe(p.method),
        p.date_label,
        pdfSafe(p.amount_label),
        p.receipt_number,
      ];
      for (let i = 0; i < payCols.length; i++) {
        const col = payCols[i];
        doc.text(values[i], col.x, rowY, {
          width: col.w,
          align: col.align,
          lineBreak: false,
        });
      }
      y = rowY + 16;
    }

    y += 20;
    doc.fillColor("#666").font("Helvetica").fontSize(8);
    doc.text(`Amount in words: ${pdfSafe(model.amount_in_words)}`, left, y, { width: CONTENT_WIDTH });
    y = doc.y + 2;
    doc.text(
      `Reverse charge: ${model.reverse_charge} · This is a computer-generated receipt and does not require a physical signature.`,
      left,
      y,
      { width: CONTENT_WIDTH },
    );

    doc.end();
  });
}
