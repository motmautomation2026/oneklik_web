import PDFDocument from "pdfkit";
import type { InvoiceRenderModel } from "./invoiceHtml.js";

const BRAND = "#563da4";
const PAGE_MARGIN = 48;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2;

function pdfSafe(s: string): string {
  return s.replace(/\u20B9/g, "Rs.");
}

export function renderInvoicePdf(model: InvoiceRenderModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
      info: {
        Title: model.invoice_number,
        Author: "One-Klik",
        Subject: model.document_title,
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = PAGE_MARGIN;
    const right = PAGE_MARGIN + CONTENT_WIDTH;
    let y = PAGE_MARGIN;

    // Header: brand left, title + INV right
    doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(18).text("One-Klik", left, y, { lineBreak: false });
    doc.fillColor("#111").font("Helvetica-Bold").fontSize(20).text(model.document_title, left, y, {
      width: CONTENT_WIDTH,
      align: "right",
      lineBreak: false,
    });
    y += 24;
    doc.fillColor("#333").font("Helvetica").fontSize(10).text(model.invoice_number, left, y, {
      width: CONTENT_WIDTH,
      align: "right",
    });
    y = doc.y + 16;

    // Summary
    doc.fillColor("#333").font("Helvetica-Bold").fontSize(10);
    const dateLabel = model.is_proforma ? "Invoice Date" : "Date Paid";
    doc.text(dateLabel, left, y, { continued: true, width: 100 });
    doc.font("Helvetica").fillColor("#111").text(`  ${model.invoice_date_label}`);
    y = doc.y + 4;

    if (model.is_proforma && model.due_date_label) {
      doc.fillColor("#333").font("Helvetica-Bold").text("Due Date", left, y, { continued: true, width: 100 });
      doc.font("Helvetica").fillColor("#111").text(`  ${model.due_date_label}`);
      y = doc.y + 4;
    }

    if (model.is_proforma) {
      y += 6;
      doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(16).text(pdfSafe(model.amount_due_label), left, y);
      y = doc.y + 6;
    }

    doc.fillColor("#333").font("Helvetica-Bold").fontSize(10).text("Status", left, y, { continued: true });
    doc.font("Helvetica").fillColor(model.status === "PAID" ? "#1a7f37" : BRAND).text(`  ${model.status}`);
    y = doc.y + 6;

    if (!model.is_proforma && model.receipt_number) {
      doc.fillColor("#333").font("Helvetica-Bold").text("Receipt", left, y, { continued: true });
      doc.font("Helvetica").fillColor("#111").text(`  ${model.receipt_number}`);
      y = doc.y + 6;
    }

    if (model.note) {
      y += 4;
      doc.fillColor("#666").font("Helvetica").fontSize(9).text(model.note, left, y, { width: CONTENT_WIDTH });
      y = doc.y + 10;
    } else {
      y += 10;
    }

    // Parties
    const colW = CONTENT_WIDTH / 2 - 10;
    const sy = y;
    doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(10).text("From", left, sy);
    doc.fillColor("#111").font("Helvetica-Bold").fontSize(10).text(pdfSafe(model.seller.legal_name), left, sy + 14);
    doc.font("Helvetica").fontSize(9).fillColor("#222");
    let ly = sy + 28;
    for (const line of model.seller.address_lines) {
      doc.text(pdfSafe(line), left, ly, { width: colW });
      ly = doc.y + 2;
    }
    doc.text(`GST: ${model.seller.gstin}`, left, ly, { width: colW });
    ly = doc.y + 2;
    if (model.seller.billing_email) {
      doc.text(model.seller.billing_email, left, ly, { width: colW });
      ly = doc.y + 2;
    }
    if (model.seller.phone) {
      doc.text(model.seller.phone, left, ly, { width: colW });
      ly = doc.y + 2;
    }

    const bx = left + colW + 20;
    doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(10).text("Bill To", bx, sy);
    doc.fillColor("#111").font("Helvetica-Bold").fontSize(10).text(pdfSafe(model.buyer.legal_name), bx, sy + 14);
    doc.font("Helvetica").fontSize(9).fillColor("#222");
    let by = sy + 28;
    for (const line of model.buyer.address_lines) {
      doc.text(pdfSafe(line), bx, by, { width: colW });
      by = doc.y + 2;
    }
    if (model.buyer.gstin) {
      doc.text(`GST: ${model.buyer.gstin}`, bx, by, { width: colW });
      by = doc.y + 2;
    }
    if (model.buyer.email) {
      doc.text(model.buyer.email, bx, by, { width: colW });
      by = doc.y + 2;
    }

    y = Math.max(ly, by) + 18;

    // Line items header
    doc.rect(left, y, CONTENT_WIDTH, 22).fill("#efe9fb");
    doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(9);
    const cols = [
      { x: left + 8, w: 250, label: "Description", align: "left" as const },
      { x: left + 270, w: 40, label: "Qty", align: "center" as const },
      { x: left + 320, w: 100, label: "Unit Price", align: "right" as const },
      { x: left + 430, w: CONTENT_WIDTH - 438, label: "Amount", align: "right" as const },
    ];
    for (const c of cols) {
      doc.text(c.label, c.x, y + 6, { width: c.w, align: c.align });
    }
    y += 28;

    doc.font("Helvetica").fontSize(9).fillColor("#111");
    for (const li of model.line_items) {
      const rowY = y;
      doc.text(pdfSafe(li.description), cols[0].x, rowY, { width: cols[0].w });
      if (li.sac_code) {
        doc.fillColor("#888").fontSize(8).text(`SAC ${li.sac_code}`, cols[0].x, doc.y + 1, { width: cols[0].w });
        doc.fillColor("#111").fontSize(9);
      }
      const bottom = doc.y;
      doc.text(String(li.qty), cols[1].x, rowY, { width: cols[1].w, align: "center" });
      doc.text(pdfSafe(li.unit_price_label), cols[2].x, rowY, { width: cols[2].w, align: "right" });
      doc.text(pdfSafe(li.amount_label), cols[3].x, rowY, { width: cols[3].w, align: "right" });
      y = Math.max(bottom, rowY + 16) + 8;
      doc.moveTo(left, y).strokeColor("#ececec").lineWidth(0.5).lineTo(right, y).stroke();
      y += 8;
    }

    // Totals
    const totals = model.totals.filter((t) => !["Amount due", "Amount paid"].includes(t.label));
    const totalsX = right - 200;
    for (const t of totals) {
      if (t.bold) {
        doc.rect(totalsX, y - 2, 200, 18).fill("#efe9fb");
      }
      doc.fillColor("#111").font(t.bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
      doc.text(t.label, totalsX + 8, y, { width: 90 });
      doc.text(pdfSafe(t.amount_label), totalsX + 90, y, { width: 102, align: "right" });
      y += 18;
    }
    y += 6;
    doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(11);
    doc.text(
      model.is_proforma
        ? `Amount Due ${pdfSafe(model.amount_due_label)}`
        : `Amount Paid ${pdfSafe(model.amount_paid_label)}`,
      totalsX,
      y,
      { width: 200, align: "right" },
    );
    y = doc.y + 16;

    if (model.is_proforma) {
      doc.fillColor("#111").font("Helvetica-Bold").fontSize(10).text("Payment Due", left, y);
      y = doc.y + 4;
      doc.fillColor("#444").font("Helvetica").fontSize(9).text(
        `Please pay the above amount${model.due_date_label ? ` by ${model.due_date_label}` : ""}. A 3-day grace period applies after the due date.`,
        left,
        y,
        { width: CONTENT_WIDTH },
      );
      y = doc.y + 10;
      doc.fillColor("#111").font("Helvetica-Bold").fontSize(10).text("Bank / Payment", left, y);
      y = doc.y + 4;
      doc.fillColor("#444").font("Helvetica").fontSize(9).text(
        "You can make the payment via Razorpay from Billing or Plans.",
        left,
        y,
        { width: CONTENT_WIDTH },
      );
      y = doc.y + 14;
    }

    doc.fillColor("#666").font("Helvetica").fontSize(8);
    doc.text(`Amount in words: ${pdfSafe(model.amount_in_words)}`, left, y, { width: CONTENT_WIDTH });
    y = doc.y + 2;
    doc.text(`Place of supply: ${model.place_of_supply} · Reverse charge: ${model.reverse_charge}`, left, y, {
      width: CONTENT_WIDTH,
    });
    y = doc.y + 2;
    doc.text(
      `This is a computer-generated ${model.is_proforma ? "pro forma invoice" : "invoice"} and does not require a signature.`,
      left,
      y,
      { width: CONTENT_WIDTH },
    );

    doc.end();
  });
}
